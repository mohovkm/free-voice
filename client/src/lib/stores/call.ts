import { derived, writable } from 'svelte/store';
import { CallMode, CallPhase, type CallEndReasonValue, type CallState } from '$lib/types/call';

export const CallEndReason = Object.freeze<Record<string, CallEndReasonValue>>({
	HANGUP: 'hangup',
	REMOTE_HANGUP: 'remote_hangup',
	DECLINED: 'declined',
	BUSY: 'busy',
	NO_ANSWER: 'no_answer',
	CANCELLED: 'cancelled',
	ANSWERED_ELSEWHERE: 'answered_elsewhere',
	NETWORK_ERROR: 'network_error',
	ERROR: 'error'
});

const initialState: CallState = {
	phase: CallPhase.IDLE,
	endReason: null,
	micMuted: false,
	camOff: false,
	video: true,
	remoteName: '',
	roomName: null,
	roomId: null,
	mode: CallMode.P2P,
	callStartedAt: null,
	participantCount: 0,
	participantLabel: '',
	waitingForOthers: false
};

const store = writable<CallState>({ ...initialState });

export const callStore = { subscribe: store.subscribe };
export const isInCall = derived(
	store,
	($state) => $state.phase !== CallPhase.IDLE && $state.phase !== CallPhase.ENDED
);
export const showEndScreen = derived(store, ($state) => $state.phase === CallPhase.ENDED);

export function _update(patch: Partial<CallState>): void {
	store.update((state) => ({ ...state, ...patch }));
}

export function _reset(): void {
	store.set({ ...initialState });
}
