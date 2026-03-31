/**
 * mediaCache.ts — LoadingCache for Matrix media blobs.
 *
 * Architecture: two-layer cache.
 *   Layer 1 (in-memory):  Map<mxcUrl, Promise<Blob|null>>
 *                         Deduplicates concurrent requests for the same media.
 *                         A null result is evicted from the map so the next
 *                         request can retry (transient failure or 404).
 *   Layer 2 (IndexedDB):  Blobs persisted across page loads; LRU eviction at 100 MB.
 *
 * Public API:
 *   get(mxcUrl, httpUrl)  → Promise<Blob|null>   (null = expired or unavailable)
 *   put(mxcUrl, blob)     → void                 (pre-populate; call after upload)
 */

const DB_NAME = 'freevoice-media';
const DB_VERSION = 1;
const STORE = 'mediacache';

export const MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB
export const TARGET_CACHE_BYTES = 80 * 1024 * 1024; // evict to this

interface MediaCacheEntry {
	mxcUrl: string;
	blob: Blob;
	mimeType: string;
	size: number;
	accessedAt: number;
}

// Layer 1: in-memory loading cache
const _mem = new Map<string, Promise<Blob | null>>(); // mxcUrl → Promise<Blob|null>

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = (event) => {
			const db =
				(event.target as IDBOpenDBRequest | null)?.result ??
				request.result;
			if (!db.objectStoreNames.contains(STORE)) {
				const store = db.createObjectStore(STORE, { keyPath: 'mxcUrl' });
				store.createIndex('accessedAt', 'accessedAt');
			}
		};
		request.onsuccess = (event) =>
			resolve((event.target as IDBOpenDBRequest | null)?.result ?? request.result);
		request.onerror = (event) =>
			reject((event.target as IDBRequest | null)?.error ?? request.error);
	});
}

function openDbWithTimeout(): Promise<IDBDatabase> {
	// openDb() can hang indefinitely on iOS after background resume (WebKit bug #235579).
	return Promise.race([
		openDb(),
		new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('idb-timeout')), 2000))
	]);
}

function getEntry(db: IDBDatabase, mxcUrl: string): Promise<MediaCacheEntry | null> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readonly');
		const request = transaction.objectStore(STORE).get(mxcUrl);
		request.onsuccess = (event) => {
			const result =
				(event.target as IDBRequest<MediaCacheEntry> | null)?.result ??
				request.result;
			resolve(result ?? null);
		};
		request.onerror = (event) =>
			reject((event.target as IDBRequest | null)?.error ?? request.error);
	});
}

function putEntry(db: IDBDatabase, entry: MediaCacheEntry): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readwrite');
		const request = transaction.objectStore(STORE).put(entry);
		request.onsuccess = () => resolve();
		request.onerror = (event) =>
			reject((event.target as IDBRequest | null)?.error ?? request.error);
	});
}

function deleteEntry(db: IDBDatabase, mxcUrl: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readwrite');
		const request = transaction.objectStore(STORE).delete(mxcUrl);
		request.onsuccess = () => resolve();
		request.onerror = (event) =>
			reject((event.target as IDBRequest | null)?.error ?? request.error);
	});
}

function getAllEntries(db: IDBDatabase): Promise<MediaCacheEntry[]> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readonly');
		const index = transaction.objectStore(STORE).index('accessedAt');
		const request = index.getAll();
		request.onsuccess = (event) => {
			const result =
				(event.target as IDBRequest<MediaCacheEntry[]> | null)?.result ??
				request.result;
			resolve(result ?? []);
		};
		request.onerror = (event) =>
			reject((event.target as IDBRequest | null)?.error ?? request.error);
	});
}

async function evictIfNeeded(db: IDBDatabase): Promise<void> {
	const entries = await getAllEntries(db); // sorted by accessedAt asc
	let total = entries.reduce((sum, entry) => sum + entry.size, 0);
	if (total <= MAX_CACHE_BYTES) return;
	for (const entry of entries) {
		if (total <= TARGET_CACHE_BYTES) break;
		await deleteEntry(db, entry.mxcUrl);
		total -= entry.size;
	}
}

// ─── Internal loader ─────────────────────────────────────────────────────────

async function _loadBlob(mxcUrl: string, httpUrl: string): Promise<Blob | null> {
	// Try IndexedDB first (skip in SSR / non-browser contexts)
	if (typeof indexedDB !== 'undefined') {
		try {
			const db = await openDbWithTimeout();
			const cached = await getEntry(db, mxcUrl);
			if (cached?.blob) {
				// Update LRU timestamp fire-and-forget
				putEntry(db, { ...cached, accessedAt: Date.now() }).catch(() => {});
				// Re-wrap the IDB blob: WebKit sometimes loses internal backing data
				// integrity when a Blob is stored in and retrieved from IndexedDB.
				// Re-wrapping forces rehydration from the raw bytes.
				try {
					const buf = await cached.blob.arrayBuffer();
					return new Blob([buf], { type: cached.blob.type || cached.mimeType });
				} catch {
					// If arrayBuffer() fails the blob is corrupt — fall through to re-fetch
				}
			}
		} catch {
			// IDB unavailable or timeout — fall through to fetch
		}
	}

	// Cache miss: fetch from server
	let response: Response;
	try {
		response = await fetch(httpUrl);
	} catch {
		return null; // Network error
	}

	if (response.status === 404) return null; // Media expired
	if (!response.ok) return null; // Other server error

	let blob: Blob;
	try {
		// Use arrayBuffer() instead of blob() — avoids ReadableStreamReader crashes
		// on iOS/WebKit for large responses (WebKit bug #302282).
		const contentType = response.headers.get('content-type') || '';
		const buffer = await response.arrayBuffer();
		blob = new Blob([buffer], { type: contentType });
	} catch {
		return null;
	}

	// Persist to IDB fire-and-forget — don't block the return on a slow IDB write.
	_persistToIdb(mxcUrl, blob);
	return blob;
}

function _persistToIdb(mxcUrl: string, blob: Blob): void {
	if (typeof indexedDB === 'undefined') return;
	openDbWithTimeout()
		.then((db) =>
			putEntry(db, {
				mxcUrl,
				blob,
				mimeType: blob.type,
				size: blob.size,
				accessedAt: Date.now()
			}).then(() => evictIfNeeded(db))
		)
		.catch(() => {});
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a Blob for the given mxc:// URI.
 *
 * Deduplicates concurrent requests: if a load is already in-flight for
 * `mxcUrl`, the same Promise is returned to all callers (Guava LoadingCache
 * semantics). Returns null if the resource is expired (404) or unavailable.
 *
 * Callers are responsible for creating and revoking blob URLs:
 *   const blob = await mediaCache.get(mxcUrl, httpUrl);
 *   if (blob) { const url = URL.createObjectURL(blob); ... URL.revokeObjectURL(url); }
 *
 * @param {string} mxcUrl   The mxc:// URI used as the cache key.
 * @param {string} httpUrl  Authenticated HTTP URL to fetch on cache miss.
 * @returns {Promise<Blob|null>}
 */
export function get(mxcUrl: string | null | undefined, httpUrl: string | null | undefined): Promise<Blob | null> {
	if (!mxcUrl || !httpUrl) return Promise.resolve(null);
	const existing = _mem.get(mxcUrl);
	if (existing) return existing;

	const promise = _loadBlob(mxcUrl, httpUrl);
	_mem.set(mxcUrl, promise);

	// Remove null results from in-memory cache to allow retry on next call
	promise.then((blob) => {
		if (blob === null && _mem.get(mxcUrl) === promise) _mem.delete(mxcUrl);
	});

	return promise;
}

/**
 * Pre-populate the cache with a known Blob.
 * Call this after a successful media upload so the sender never re-downloads
 * their own media.
 *
 * @param {string} mxcUrl
 * @param {Blob} blob
 */
export function put(mxcUrl: string | null | undefined, blob: Blob | null | undefined): void {
	if (!mxcUrl || !blob) return;
	_mem.set(mxcUrl, Promise.resolve(blob));
	_persistToIdb(mxcUrl, blob);
}
