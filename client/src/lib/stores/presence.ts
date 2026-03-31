import { writable } from 'svelte/store';
import { backend } from '$lib/services/activeBackend';
import { MatrixPresence } from '$lib/types/matrix';

export type PresenceMap = Record<string, boolean>;

export const presenceMap = writable<PresenceMap>({});

let unsubscribePresence: (() => void) | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
	const contacts = backend.getDMContacts?.();
	if (!contacts?.length) return;
	const userIds = contacts
		.map((contact: { email?: string | null }) => contact.email)
		.filter(Boolean);
	const map =
		(await backend
			.fetchPresence?.(userIds as string[])
			.catch(() => ({}) as Record<string, string>)) ?? {};
	presenceMap.set(
		Object.fromEntries(
			Object.entries(map).map(([key, value]) => [key, value === MatrixPresence.ONLINE])
		)
	);
}

export function startPresenceTracking(): () => void {
	stop();
	void refresh();
	unsubscribePresence =
		backend.onPresenceChanged?.(async () => {
			await refresh();
		}) ?? null;
	refreshInterval = setInterval(refresh, 15_000);
	return stop;
}

export function stop(): void {
	unsubscribePresence?.();
	unsubscribePresence = null;
	if (refreshInterval) {
		clearInterval(refreshInterval);
		refreshInterval = null;
	}
}
