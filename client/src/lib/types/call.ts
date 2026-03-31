export const CallPhase = Object.freeze({
	IDLE: 'idle',
	ACQUIRING_MEDIA: 'acquiring_media',
	REGISTERING: 'registering',
	RINGING_OUT: 'ringing_out',
	RINGING_IN: 'ringing_in',
	CONNECTING: 'connecting',
	CONNECTED: 'connected',
	RECONNECTING: 'reconnecting',
	ENDED: 'ended'
} as const);

export type CallPhase = (typeof CallPhase)[keyof typeof CallPhase];

export const CallMode = Object.freeze({
	P2P: 'p2p',
	ROOM: 'room',
	GUEST: 'guest'
} as const);

export type CallMode = (typeof CallMode)[keyof typeof CallMode];

export type CallEndReasonValue =
	| 'hangup'
	| 'remote_hangup'
	| 'declined'
	| 'busy'
	| 'no_answer'
	| 'cancelled'
	| 'answered_elsewhere'
	| 'network_error'
	| 'error';

export interface CallState {
	phase: CallPhase;
	endReason: CallEndReasonValue | null;
	micMuted: boolean;
	camOff: boolean;
	video: boolean;
	remoteName: string;
	roomName: string | null;
	roomId: string | null;
	mode: CallMode;
	callStartedAt: string | null;
	participantCount: number;
	participantLabel: string;
	waitingForOthers: boolean;
}
