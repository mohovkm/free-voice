import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/services/activeBackend', () => ({
	backend: { getUnreadCounts: vi.fn() }
}));

const {
	unreadCounts,
	totalUnread,
	totalHighlight,
	incrementUnread,
	clearUnread,
	loadUnread,
	activeRoomId
} = await import('@client/lib/stores/unread');
const { backend } = await import('$lib/services/activeBackend');

beforeEach(() => {
	unreadCounts.set({});
	activeRoomId.set(null);
	vi.clearAllMocks();
});

describe('unreadCounts store', () => {
	it('starts empty', () => {
		expect(get(unreadCounts)).toEqual({});
	});

	it('incrementUnread is a no-op (SDK drives counts)', () => {
		incrementUnread('!room:test');
		expect(get(unreadCounts)['!room:test']).toBeUndefined();
	});

	it('clearUnread removes entry', () => {
		unreadCounts.set({ '!room:test': { total: 2, highlight: 0 } });
		clearUnread('!room:test');
		expect(get(unreadCounts)['!room:test']).toBeUndefined();
	});

	it('clearUnread on unknown key does not throw', () => {
		expect(() => clearUnread('!unknown:test')).not.toThrow();
	});

	it('accepts { total, highlight } shape from SDK', () => {
		unreadCounts.set({ '!a:test': { total: 3, highlight: 1 } });
		expect(get(unreadCounts)['!a:test'].total).toBe(3);
		expect(get(unreadCounts)['!a:test'].highlight).toBe(1);
	});
});

describe('totalUnread derived store', () => {
	it('is 0 when empty', () => {
		expect(get(totalUnread)).toBe(0);
	});

	it('sums total counts across rooms', () => {
		unreadCounts.set({
			'!a:test': { total: 2, highlight: 1 },
			'!b:test': { total: 1, highlight: 0 }
		});
		expect(get(totalUnread)).toBe(3);
	});

	it('excludes the active room', () => {
		unreadCounts.set({
			'!a:test': { total: 2, highlight: 0 },
			'!b:test': { total: 1, highlight: 0 }
		});
		activeRoomId.set('!a:test');
		expect(get(totalUnread)).toBe(1);
	});
});

describe('totalHighlight derived store', () => {
	it('sums highlight counts across rooms', () => {
		unreadCounts.set({
			'!a:test': { total: 3, highlight: 2 },
			'!b:test': { total: 1, highlight: 0 }
		});
		expect(get(totalHighlight)).toBe(2);
	});
});

describe('loadUnread', () => {
	it('subscribes to Matrix backend and returns unsubscribe fn', async () => {
		const unsub = vi.fn();
		backend.getUnreadCounts.mockReturnValue(unsub);
		const result = await loadUnread();
		expect(backend.getUnreadCounts).toHaveBeenCalledOnce();
		expect(result).toBe(unsub);
	});
});
