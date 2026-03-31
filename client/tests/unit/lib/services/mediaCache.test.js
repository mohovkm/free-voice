import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get, put, MAX_CACHE_BYTES } from '@client/lib/services/mediaCache';

// ---------------------------------------------------------------------------
// IndexedDB mock
// ---------------------------------------------------------------------------
// We use a simple in-memory store to simulate the IndexedDB API.

let _store = {};
let _openError = null;

function makeRequest(result, error = null) {
	const req = {};
	setTimeout(() => {
		if (error) req.onerror?.({ target: { error } });
		else req.onsuccess?.({ target: { result } });
	}, 0);
	return req;
}

function makeTx(storeData) {
	const objectStore = {
		get: (key) => makeRequest(storeData[key] ?? undefined),
		put: (entry) => { storeData[entry.mxcUrl] = entry; return makeRequest(undefined); },
		delete: (key) => { delete storeData[key]; return makeRequest(undefined); },
		index: () => ({
			getAll: () => makeRequest(Object.values(storeData).sort((a, b) => a.accessedAt - b.accessedAt))
		})
	};
	return { objectStore: () => objectStore };
}

beforeEach(() => {
	_store = {};
	_openError = null;
	vi.restoreAllMocks();

	// Mock indexedDB.open
	globalThis.indexedDB = {
		open: () => {
			const req = {};
			setTimeout(() => {
				if (_openError) {
					req.onerror?.({ target: { error: _openError } });
					return;
				}
				// Simulate upgradeneeded then success
				const db = {
					objectStoreNames: { contains: () => true },
					transaction: (_storeName, _mode) => makeTx(_store),
					createObjectStore: () => ({ createIndex: () => {} })
				};
				req.onupgradeneeded?.({ target: { result: db } });
				req.onsuccess?.({ target: { result: db } });
			}, 0);
			return req;
		}
	};

	// Mock URL.createObjectURL
	globalThis.URL.createObjectURL = vi.fn((blob) => `blob:fake/${blob.size}`);
	globalThis.URL.revokeObjectURL = vi.fn();
});

describe('get()', () => {
	it('returns null when mxcUrl or httpUrl is falsy', async () => {
		expect(await get('', 'http://example.com/x')).toBeNull();
		expect(await get('mxc://example.com/x', '')).toBeNull();
		expect(await get(null, null)).toBeNull();
	});

	it('cache miss: fetches from server, stores in IDB, returns Blob', async () => {
		const fakeBlob = new Blob(['audio'], { type: 'audio/ogg' });
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(fakeBlob, { status: 200 })
		);

		const result = await get('mxc://example.com/audio1', 'http://localhost/_matrix/download/example.com/audio1');

		expect(fetch).toHaveBeenCalledWith('http://localhost/_matrix/download/example.com/audio1');
		expect(result).toBeInstanceOf(Blob);
		// Flush the fire-and-forget _persistToIdb promise chain (openDb uses setTimeout 0)
		await new Promise(resolve => setTimeout(resolve, 10));
		// Entry should now be in the IDB store
		expect(_store['mxc://example.com/audio1']).toBeDefined();
		expect(_store['mxc://example.com/audio1'].mimeType).toBe('audio/ogg');
	});

	it('cache hit (IDB): returns Blob without fetching from server', async () => {
		const fakeBlob = new Blob(['cached'], { type: 'image/jpeg' });
		_store['mxc://example.com/img1'] = {
			mxcUrl: 'mxc://example.com/img1',
			blob: fakeBlob,
			mimeType: 'image/jpeg',
			size: fakeBlob.size,
			accessedAt: Date.now() - 1000
		};
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const result = await get('mxc://example.com/img1', 'http://localhost/_matrix/download/example.com/img1');

		expect(fetchSpy).not.toHaveBeenCalled();
		// Re-wrap creates a new Blob instance (WebKit IDB integrity fix), so use toStrictEqual
		expect(result).toBeInstanceOf(Blob);
		expect(result.type).toBe('image/jpeg');
		// accessedAt should be updated
		expect(_store['mxc://example.com/img1'].accessedAt).toBeGreaterThan(Date.now() - 100);
	});

	it('deduplicates concurrent requests: same Promise returned for same key', async () => {
		const fakeBlob = new Blob(['data'], { type: 'video/mp4' });
		let fetchCount = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			fetchCount++;
			return Promise.resolve(new Response(fakeBlob, { status: 200 }));
		});

		const p1 = get('mxc://example.com/vid1', 'http://localhost/_matrix/download/example.com/vid1');
		const p2 = get('mxc://example.com/vid1', 'http://localhost/_matrix/download/example.com/vid1');

		expect(p1).toBe(p2); // Same Promise object
		await p1;
		expect(fetchCount).toBe(1); // Only one network request
	});

	it('returns null on 404 (expired media)', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(null, { status: 404 })
		);

		const result = await get('mxc://example.com/gone', 'http://localhost/_matrix/download/example.com/gone');

		expect(result).toBeNull();
	});

	it('returns null on non-404 server errors', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(null, { status: 500 })
		);

		const result = await get('mxc://example.com/err', 'http://localhost/_matrix/download/example.com/err');

		expect(result).toBeNull();
	});

	it('evicts LRU entries when cache exceeds MAX_CACHE_BYTES', async () => {
		// Each entry is just over 1/3 of MAX so 3 entries exceed MAX, triggering eviction
		const ENTRY_SIZE = Math.floor(MAX_CACHE_BYTES / 3) + 1;
		// Pre-populate cache with 3 large entries
		for (let i = 0; i < 3; i++) {
			_store[`mxc://example.com/big${i}`] = {
				mxcUrl: `mxc://example.com/big${i}`,
				blob: new Blob([new Uint8Array(1)], { type: 'image/jpeg' }),
				mimeType: 'image/jpeg',
				size: ENTRY_SIZE,
				accessedAt: Date.now() - (3 - i) * 1000 // big0 is oldest
			};
		}

		// Total is now 3 * ENTRY_SIZE > MAX_CACHE_BYTES; adding a new entry triggers eviction
		const fakeBlob = new Blob(['new'], { type: 'image/png' });
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(fakeBlob, { status: 200 })
		);

		await get('mxc://example.com/new', 'http://localhost/_matrix/download/example.com/new');
		// Flush the fire-and-forget _persistToIdb + evictIfNeeded chain
		await new Promise(resolve => setTimeout(resolve, 10));

		// big0 (oldest) should have been evicted
		expect(_store['mxc://example.com/big0']).toBeUndefined();
		// The new entry should be present
		expect(_store['mxc://example.com/new']).toBeDefined();
	});
});

describe('put()', () => {
	it('stores a Blob in IDB and makes it available via get()', async () => {
		const blob = new Blob(['video data'], { type: 'video/mp4' });
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		put('mxc://example.com/uploaded', blob);

		// get() should return the same blob without fetching
		const result = await get('mxc://example.com/uploaded', 'http://localhost/_matrix/download/example.com/uploaded');
		expect(result).toBe(blob);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('no-ops for falsy arguments', () => {
		expect(() => put('', new Blob())).not.toThrow();
		expect(() => put('mxc://x', null)).not.toThrow();
	});
});
