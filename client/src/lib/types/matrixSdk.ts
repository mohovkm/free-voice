export interface MatrixAccountDataEvent<T = Record<string, unknown>> {
	getContent: () => T;
}

export interface MatrixUnsignedData {
	transaction_id?: string | null;
}

export interface MatrixStateEventLike {
	getContent?: () => Record<string, unknown>;
	getSender?: () => string;
}

export interface MatrixRoomMemberLike {
	userId: string;
	membership?: string;
	name?: string | null;
	roomId?: string;
	typing?: boolean;
}

export interface MatrixUserLike {
	userId?: string;
	displayName?: string | null;
	presence?: string | null;
}

export interface MatrixEventLike {
	status?: unknown;
	sender?: { name?: string | null };
	getId: () => string | null;
	getRoomId: () => string | null;
	getSender: () => string;
	getType: () => string;
	getContent: () => Record<string, unknown>;
	getTs: () => number;
	getUnsignedData?: () => MatrixUnsignedData;
	getLocalAge?: () => number;
}

export interface MatrixTimelineLike {
	getEvents: () => MatrixEventLike[];
}

export interface MatrixRoomLike {
	roomId: string;
	name?: string;
	currentState?: {
		getMembers?: () => MatrixRoomMemberLike[];
		getStateEvents?: (eventType: string, stateKey: string) => MatrixStateEventLike | null | undefined;
	};
	getMyMembership: () => string;
	getLastActiveTimestamp: () => number | null | undefined;
	getLiveTimeline: () => MatrixTimelineLike;
	getUnreadNotificationCount: (kind: MatrixUnreadNotificationKind) => number;
	getJoinedMemberCount?: () => number;
	getJoinedMembers?: () => MatrixRoomMemberLike[];
	getEventReadUpTo?: (userId: string) => string | null;
	findEventById?: (eventId: string) => MatrixEventLike | null | undefined;
	loadMembersIfNeeded?: () => Promise<unknown> | unknown;
}

export interface MatrixPresenceResponse {
	presence?: string | null;
	last_active_ago?: number | null;
}

export interface MatrixProfileInfo {
	displayname?: string | null;
}

export interface MatrixCreateRoomResponse {
	room_id?: string;
}

export interface MatrixUploadResponse {
	content_uri: string;
}

export interface MatrixLoginResponse {
	access_token: string;
	user_id: string;
	device_id: string;
}

export interface MatrixRegisterResponse extends Partial<MatrixLoginResponse> {
	user_id: string;
}

export interface MatrixUiAuthError extends Error {
	httpStatus?: number;
	data?: {
		session?: string;
	};
}

export interface MatrixClientLike {
	login?: (loginType: string, payload: Record<string, unknown>) => Promise<MatrixLoginResponse>;
	register?: (
		username: string,
		password: string,
		sessionId?: string | null,
		auth?: Record<string, unknown> | null
	) => Promise<MatrixRegisterResponse>;
	logout?: () => Promise<unknown>;
	startClient: (options: Record<string, unknown>) => unknown;
	stopClient: () => unknown;
	clearStores: () => Promise<unknown>;
	initRustCrypto: () => Promise<unknown>;
	getSyncState: () => string | null;
	on: (eventName: string, handler: (...args: any[]) => void) => unknown;
	off: (eventName: string, handler: (...args: any[]) => void) => unknown;
	once: (eventName: string, handler: (...args: any[]) => void) => unknown;
	getRoom: (roomId: string) => MatrixRoomLike | null | undefined;
	getRooms: () => MatrixRoomLike[];
	getUser: (userId: string) => MatrixUserLike | null | undefined;
	getUserId: () => string;
	getDeviceId?: () => string | null | undefined;
	getAccessToken: () => string | null | undefined;
	getHomeserverUrl: () => string;
	getAccountData: <T = Record<string, unknown>>(
		eventType: string
	) => MatrixAccountDataEvent<T> | null | undefined;
	setAccountData: (eventType: string, content: Record<string, unknown>) => Promise<unknown>;
	createRoom: (payload: Record<string, unknown>) => Promise<MatrixCreateRoomResponse>;
	joinRoom: (roomId: string) => Promise<unknown>;
	leave: (roomId: string) => Promise<unknown>;
	forget: (roomId: string) => Promise<unknown>;
	getProfileInfo: (userId: string) => Promise<MatrixProfileInfo | null | undefined>;
	setDisplayName: (name: string) => Promise<unknown>;
	getPresence: (userId: string) => Promise<MatrixPresenceResponse>;
	sendTyping: (roomId: string, isTyping: boolean, timeout?: number) => Promise<unknown>;
	sendReadReceipt: (event: MatrixEventLike) => Promise<unknown>;
	sendMessage: (
		roomId: string,
		content: Record<string, unknown>,
		txnId?: string
	) => Promise<unknown>;
	sendEvent: (roomId: string, eventType: string, content: Record<string, unknown>) => Promise<unknown>;
	sendStateEvent: (
		roomId: string,
		eventType: string,
		content: Record<string, unknown>,
		stateKey: string
	) => Promise<unknown>;
	uploadContent: (file: File, options: Record<string, unknown>) => Promise<MatrixUploadResponse>;
	paginateEventTimeline: (
		timeline: MatrixTimelineLike,
		options: { backwards: boolean; limit: number }
	) => Promise<boolean>;
	mxcUrlToHttp: (mxcUrl: string) => string | null | undefined;
	setSyncPresence?: (state: string) => Promise<unknown> | unknown;
}
export const MatrixSyncState = Object.freeze({
	PREPARED: 'PREPARED',
	SYNCING: 'SYNCING',
	STOPPED: 'STOPPED',
	ERROR: 'ERROR'
} as const);

export type MatrixSyncState = (typeof MatrixSyncState)[keyof typeof MatrixSyncState];

export const MatrixUnreadNotificationKind = Object.freeze({
	TOTAL: 'total',
	HIGHLIGHT: 'highlight'
} as const);

export type MatrixUnreadNotificationKind =
	(typeof MatrixUnreadNotificationKind)[keyof typeof MatrixUnreadNotificationKind];
