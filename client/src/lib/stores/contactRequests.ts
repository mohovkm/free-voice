import { writable } from 'svelte/store';
import { backend } from '$lib/services/activeBackend';

export const requestCount = writable(0);

// TODO 2026-03-26: move to service
export async function refreshRequestCount(): Promise<void> {
	const requests = backend.getContactRequests();
	requestCount.set(requests.length);
}
