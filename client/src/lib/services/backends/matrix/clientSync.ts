import { MatrixPresence } from '$lib/types/matrix';

export const START_CLIENT_OPTIONS = {
	initialSyncLimit: 1,
	lazyLoadMembers: true
} as const;

export function setOnlinePresence(
	client: { setSyncPresence?: (state: string) => Promise<unknown> | unknown } | null
): void {
	const result = client?.setSyncPresence?.(MatrixPresence.ONLINE);
	if (result && typeof (result as Promise<unknown>).catch === 'function') {
		(result as Promise<unknown>).catch(() => {});
	}
}
