import { writable } from 'svelte/store';
import type { ConversationSummary, UnreadCountMap } from '$lib/types/matrix';

const conversationsStore = writable<ConversationSummary[]>([]);
const unreadCountsStore = writable<UnreadCountMap>({});

export const conversations = { subscribe: conversationsStore.subscribe };
export const unreadCounts = { subscribe: unreadCountsStore.subscribe };

export function setConversations(list: ConversationSummary[]): void {
	conversationsStore.set(list);
}

export function setUnreadCounts(counts: UnreadCountMap): void {
	unreadCountsStore.set(counts);
}

export function clearUnread(contactId: string): void {
	unreadCountsStore.update((counts) => {
		const next = { ...counts };
		delete next[contactId];
		return next;
	});
}
