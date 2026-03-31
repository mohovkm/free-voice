import { derived, writable } from 'svelte/store';
import { backend } from '$lib/services/activeBackend';
import type { UnreadCount, UnreadCountMap } from '$lib/types/matrix';

export const unreadCounts = writable<UnreadCountMap>({});
export const activeRoomId = writable<string | null>(null);

export const totalUnread = derived([unreadCounts, activeRoomId], ([$counts, $active]) =>
	Object.entries($counts).reduce((sum, [id, value]) => {
		if (id === $active) return sum;
		return sum + value.total;
	}, 0)
);

export const totalHighlight = derived([unreadCounts, activeRoomId], ([$counts, $active]) =>
	Object.entries($counts).reduce((sum, [id, value]) => {
		if (id === $active) return sum;
		return sum + value.highlight;
	}, 0)
);

/** No-op kept for backward compat — SDK drives counts, never increment manually. */
export function incrementUnread(): void {}

export function clearUnread(roomId: string): void {
	unreadCounts.update((counts) => {
		const next = { ...counts };
		delete next[roomId];
		return next;
	});
}

export async function loadUnread(): Promise<(() => void) | undefined> {
	return backend.getUnreadCounts?.((counts: UnreadCountMap) => unreadCounts.set(counts));
}

export type { UnreadCount };
