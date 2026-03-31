/** idb.ts — minimal IndexedDB wrapper for crypto key + device ID storage */

const DB_NAME = 'freevoice';
const DB_VERSION = 1;
const STORE = 'keystore';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = (event) => {
			const db =
				(event.target as IDBOpenDBRequest | null)?.result ??
				request.result;
			db.createObjectStore(STORE);
		};
		request.onsuccess = (event) =>
			resolve((event.target as IDBOpenDBRequest | null)?.result ?? request.result);
		request.onerror = (event) =>
			reject((event.target as IDBRequest | null)?.error ?? request.error);
	});
}

export async function idbGet<T = unknown>(key: IDBValidKey): Promise<T | null> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE).objectStore(STORE).get(key);
		request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
		request.onerror = () => reject(request.error);
	});
}

export async function idbSet(key: IDBValidKey, value: unknown): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

export async function idbDelete(key: IDBValidKey): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}
