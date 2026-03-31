import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/services/activeBackend', () => ({
	backend: { getContactRequests: vi.fn() }
}));

const { requestCount, refreshRequestCount } = await import('@client/lib/stores/contactRequests');
const { backend } = await import('$lib/services/activeBackend');

describe('contactRequests store', () => {
	beforeEach(() => {
		requestCount.set(0);
		vi.clearAllMocks();
	});

	it('starts at 0', () => {
		expect(get(requestCount)).toBe(0);
	});

	it('refreshRequestCount sets count from Matrix backend', async () => {
		backend.getContactRequests.mockReturnValue([{}, {}, {}]);
		await refreshRequestCount();
		expect(get(requestCount)).toBe(3);
	});

	it('refreshRequestCount sets 0 when no requests', async () => {
		backend.getContactRequests.mockReturnValue([]);
		await refreshRequestCount();
		expect(get(requestCount)).toBe(0);
	});
});
