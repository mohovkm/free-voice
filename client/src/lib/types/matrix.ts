export const MatrixMessageType = Object.freeze({
	TEXT: 'm.text',
	IMAGE: 'm.image',
	AUDIO: 'm.audio',
	VIDEO: 'm.video',
	FILE: 'm.file'
} as const);

export type MatrixMessageType = (typeof MatrixMessageType)[keyof typeof MatrixMessageType];

export const MatrixTimelineType = Object.freeze({
	TEXT: 'text',
	IMAGE: 'image',
	AUDIO: 'audio',
	VIDEO: 'video',
	FILE: 'file',
	CALL: 'call',
	SYSTEM: 'system'
} as const);

export type MatrixTimelineMessageType =
	(typeof MatrixTimelineType)[
		| 'TEXT'
		| 'IMAGE'
		| 'AUDIO'
		| 'VIDEO'
		| 'FILE'];
export type MatrixTimelineType = (typeof MatrixTimelineType)[keyof typeof MatrixTimelineType];

export const MatrixEventType = Object.freeze({
	ROOM_MESSAGE: 'm.room.message',
	ROOM_MEMBER: 'm.room.member',
	ROOM_NAME: 'm.room.name',
	CALL_INVITE: 'm.call.invite',
	CALL_HANGUP: 'm.call.hangup'
} as const);

export type MatrixEventType = (typeof MatrixEventType)[keyof typeof MatrixEventType];

export const MatrixMembership = Object.freeze({
	JOIN: 'join',
	LEAVE: 'leave',
	INVITE: 'invite'
} as const);

export type MatrixMembership = (typeof MatrixMembership)[keyof typeof MatrixMembership];

export const MatrixPresence = Object.freeze({
	ONLINE: 'online',
	OFFLINE: 'offline'
} as const);

export type MatrixPresence = (typeof MatrixPresence)[keyof typeof MatrixPresence];

export const MatrixCallDirection = Object.freeze({
	INCOMING: 'incoming',
	OUTGOING: 'outgoing'
} as const);

export type MatrixCallDirection = (typeof MatrixCallDirection)[keyof typeof MatrixCallDirection];

export const MatrixCallStatus = Object.freeze({
	RINGING: 'ringing',
	MISSED: 'missed',
	ANSWERED: 'answered'
} as const);

export type MatrixCallStatus = (typeof MatrixCallStatus)[keyof typeof MatrixCallStatus];

export interface MatrixMediaPayload {
	mxcUrl: string | null;
	mimeType: string | null;
	size: number | null;
	filename: string | null;
	thumbnailUrl: string | null;
	durationSecs: number | null;
	waveformData: number[] | null;
}

export interface MatrixReplyPreview {
	eventId: string;
	body: string;
	senderName: string;
}

export interface MatrixCallMeta {
	direction: MatrixCallDirection;
	status: MatrixCallStatus;
	durationSecs: number | null;
}

export interface NormalizedTimelineEvent {
	id: string | null;
	roomId: string | null;
	senderId: string | null;
	senderName: string;
	type: MatrixTimelineType;
	body: string;
	media: MatrixMediaPayload | null;
	ts: number;
	isoTs: string;
	mine: boolean;
	txnId: string | null;
	replyTo: MatrixReplyPreview | null;
	callMeta: MatrixCallMeta | null;
}

export interface LocalEcho extends NormalizedTimelineEvent {
	txnId: string;
	_isLocalEcho?: boolean;
	_blobUrl?: string | null;
	_thumbBlobUrl?: string | null;
}

export interface ConversationLastMessage {
	text: string;
	msgtype: MatrixMessageType | (typeof MatrixTimelineType)['CALL'] | '';
}

export interface ConversationSummary {
	roomId: string;
	name: string;
	lastActiveTs: number;
	lastMessage: ConversationLastMessage;
}

export interface UnreadCount {
	total: number;
	highlight: number;
}

export type UnreadCountMap = Record<string, UnreadCount>;
