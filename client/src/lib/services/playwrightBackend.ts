import { clearSession, _setClient, _setCryptoInitPromise } from './backends/matrix/client';
import type * as MatrixBackendModule from './backends/matrix';
import {
	MatrixMessageType,
	MatrixTimelineType,
	type LocalEcho,
	type MatrixMediaPayload,
	type MatrixMessageType as MatrixMessageTypeValue,
	type MatrixTimelineType as MatrixTimelineTypeValue,
	type UnreadCountMap
} from '$lib/types/matrix';
import { addLocalEcho, resetStore } from '$lib/stores/matrixStore';

interface PlaywrightProfile {
	id?: string;
	email?: string;
	display_name?: string;
}

interface PlaywrightRoomPeer {
	name: string;
	userId: string | null;
}

interface PlaywrightConversation {
	roomId: string;
	name?: string;
	lastActiveTs?: number;
	lastMessage?: unknown;
}

interface PlaywrightDmContact {
	roomId: string;
	email: string;
	display_name: string;
	status: 'pending' | 'accepted';
}

interface PlaywrightTimelineMessage {
	id: string;
	body: string;
	type: MatrixTimelineTypeValue;
	mine?: boolean;
	senderId?: string | null;
	senderName?: string;
	ts?: number;
	replyTo?: LocalEcho['replyTo'];
	media?: MatrixMediaPayload | null;
}

interface PlaywrightBackendConfig {
	enabled?: boolean;
	profile?: PlaywrightProfile;
	contactRequests?: unknown[];
	unreadCounts?: UnreadCountMap;
	roomPeers?: Record<string, PlaywrightRoomPeer>;
	conversations?: PlaywrightConversation[];
	dmContacts?: PlaywrightDmContact[];
	roomMessagesByRoom?: Record<string, PlaywrightTimelineMessage[]>;
}

type MaybeWindow = Window & {
	__FV_PLAYWRIGHT_BACKEND__?: PlaywrightBackendConfig;
};

function getConfig(): PlaywrightBackendConfig | null {
	if (typeof window === 'undefined') return null;
	return ((window as MaybeWindow).__FV_PLAYWRIGHT_BACKEND__ as PlaywrightBackendConfig | undefined) ?? null;
}

function getProfileState(): Required<PlaywrightProfile> {
	const profile = getConfig()?.profile ?? {};
	const id = profile.id || localStorage.getItem('matrix_user_id') || '@tester:example.test';
	return {
		id,
		email: profile.email || id,
		display_name: profile.display_name || 'Tester'
	};
}

let authErrorHandler: (() => void) | null = null;
const seededRooms = new Set<string>();

const noopUnsubscribe = (): void => {};

const MEDIA_SIZE_LIMITS: Record<MatrixMessageTypeValue, number> = {
	[MatrixMessageType.IMAGE]: 10 * 1024 * 1024,
	[MatrixMessageType.AUDIO]: 5 * 1024 * 1024,
	[MatrixMessageType.VIDEO]: 25 * 1024 * 1024,
	[MatrixMessageType.FILE]: 15 * 1024 * 1024,
	[MatrixMessageType.TEXT]: Number.POSITIVE_INFINITY
};

function recordSessionJson(key: string, value: unknown): void {
	try {
		const existing = JSON.parse(sessionStorage.getItem(key) || '[]');
		existing.push(value);
		sessionStorage.setItem(key, JSON.stringify(existing));
	} catch {
		sessionStorage.setItem(key, JSON.stringify([value]));
	}
}

function toHttpUrl(mxcUrl: string): string | null {
	if (!mxcUrl.startsWith('mxc://')) return mxcUrl;
	const withoutScheme = mxcUrl.slice(6);
	const slash = withoutScheme.indexOf('/');
	if (slash === -1) return null;
	const server = withoutScheme.slice(0, slash);
	const mediaId = withoutScheme.slice(slash + 1);
	return `https://matrix.example.test/_matrix/media/v3/download/${server}/${mediaId}`;
}

function getUserId(): string {
	return getProfileState().id;
}

function addRoomMessages(roomId: string): void {
	if (seededRooms.has(roomId)) return;
	seededRooms.add(roomId);
	const messages = getConfig()?.roomMessagesByRoom?.[roomId] ?? [];
	for (const message of messages) {
		const ts = message.ts ?? Date.now();
		addLocalEcho(roomId, {
			id: message.id,
			txnId: message.id,
			roomId,
			senderId: message.senderId ?? (message.mine ? getUserId() : '@alice:example.test'),
			senderName: message.senderName ?? (message.mine ? 'Tester' : 'Alice'),
			type: message.type,
			body: message.body,
			media: message.media ?? null,
			ts,
			isoTs: new Date(ts).toISOString(),
			mine: Boolean(message.mine),
			replyTo: message.replyTo ?? null,
			callMeta: null,
			_isLocalEcho: true
		});
	}
}

function createMediaEcho(
	roomId: string,
	file: File,
	messageType: MatrixMessageTypeValue,
	audioMeta: { durationSecs: number | null; waveformData: number[] | null } | null
): LocalEcho {
	const txnId = `playwright-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const previewUrl =
		messageType === MatrixMessageType.FILE ? null : URL.createObjectURL(file);
	const type =
		messageType === MatrixMessageType.IMAGE
			? MatrixTimelineType.IMAGE
			: messageType === MatrixMessageType.AUDIO
				? MatrixTimelineType.AUDIO
				: messageType === MatrixMessageType.VIDEO
					? MatrixTimelineType.VIDEO
					: MatrixTimelineType.FILE;
	return {
		id: `echo:${txnId}`,
		txnId,
		roomId,
		senderId: getUserId(),
		senderName: getProfileState().display_name,
		type,
		body: file.name,
		media: {
			mxcUrl: previewUrl,
			mimeType: file.type,
			size: file.size,
			filename: file.name,
			thumbnailUrl: null,
			durationSecs: audioMeta?.durationSecs ?? null,
			waveformData: audioMeta?.waveformData ?? null
		},
		ts: Date.now(),
		isoTs: new Date().toISOString(),
		mine: true,
		replyTo: null,
		callMeta: null,
		_isLocalEcho: true,
		_blobUrl: previewUrl
	};
}

const backend = {
	async init(): Promise<void> {
		if (!getConfig()?.enabled) {
			authErrorHandler?.();
			return;
		}
		_setCryptoInitPromise(null);
		_setClient({
			getUserId,
			getAccessToken: () => localStorage.getItem('matrix_access_token'),
			mxcUrlToHttp: (mxcUrl: string) => toHttpUrl(mxcUrl)
		} as never);
	},
	destroy(): void {
		seededRooms.clear();
		_setClient(null);
		_setCryptoInitPromise(null);
		resetStore();
	},
	reconnectIfNeeded(): void {},
	reconnectOrReload(): void {},
	handleHide(): void {},
	resumeAudio(): void {},
	setAuthErrorHandler(callback: (() => void) | null): void {
		authErrorHandler = callback;
	},
	async logout(): Promise<void> {
		clearSession();
	},
	async getProfile(): Promise<Required<PlaywrightProfile>> {
		return getProfileState();
	},
	async setDisplayName(name: string): Promise<void> {
		const config = getConfig();
		if (!config) return;
		config.profile = { ...getProfileState(), ...(config.profile ?? {}), display_name: name };
	},
	onConversationsChanged(callback: (rooms: PlaywrightConversation[]) => void): () => void {
		callback(getConfig()?.conversations ?? []);
		return noopUnsubscribe;
	},
	onCallSignal(): () => void {
		return noopUnsubscribe;
	},
	onMessage(): () => void {
		return noopUnsubscribe;
	},
	onMembershipChanged(): () => void {
		return noopUnsubscribe;
	},
	onTypingChanged(): () => void {
		return noopUnsubscribe;
	},
	onReadReceiptChanged(): () => void {
		return noopUnsubscribe;
	},
	async getHistory(roomId: string, limit = 50): Promise<unknown[]> {
		addRoomMessages(roomId);
		const total = getConfig()?.roomMessagesByRoom?.[roomId]?.length ?? 0;
		return new Array(Math.min(limit, total));
	},
	async loadMoreHistory(): Promise<{ canLoadMore: boolean }> {
		return { canLoadMore: false };
	},
	async sendMessage(roomId: string, body: string): Promise<string> {
		const txnId = `playwright-text-${Date.now()}`;
		addLocalEcho(roomId, {
			id: `echo:${txnId}`,
			txnId,
			roomId,
			senderId: getUserId(),
			senderName: getProfileState().display_name,
			type: MatrixTimelineType.TEXT,
			body,
			media: null,
			ts: Date.now(),
			isoTs: new Date().toISOString(),
			mine: true,
			replyTo: null,
			callMeta: null,
			_isLocalEcho: true
		});
		return txnId;
	},
	async sendMediaMessage(
		roomId: string,
		file: File,
		messageType: MatrixMessageTypeValue,
		_replyToEventId: string | null = null,
		audioMeta: { durationSecs: number | null; waveformData: number[] | null } | null = null
	): Promise<string> {
		const limit = MEDIA_SIZE_LIMITS[messageType];
		if (limit !== undefined && file.size > limit) {
			const limitMB = Math.round(limit / (1024 * 1024));
			throw new Error(
				`File too large (max ${limitMB} MB). For larger files, share a link from a cloud storage service.`
			);
		}
		const echo = createMediaEcho(roomId, file, messageType, audioMeta);
		addLocalEcho(roomId, echo);
		recordSessionJson('__fv_e2e_sent_media', {
			roomId,
			messageType,
			name: file.name,
			size: file.size,
			audioMeta
		});
		return echo.txnId;
	},
	sendReadReceipt(): void {},
	getPeerReadTs(): number {
		return 0;
	},
	getPeerReadEventId(): string | null {
		return null;
	},
	notify(): null {
		return null;
	},
	getUnreadCounts(callback: (counts: UnreadCountMap) => void): () => void {
		callback(getConfig()?.unreadCounts ?? {});
		return noopUnsubscribe;
	},
	getContactRequests(): unknown[] {
		return getConfig()?.contactRequests ?? [];
	},
	getDMContacts(): PlaywrightDmContact[] {
		return getConfig()?.dmContacts ?? [];
	},
	onPresenceChanged(): () => void {
		return noopUnsubscribe;
	},
	async fetchPresence(): Promise<Record<string, string>> {
		return {};
	},
	loadDMMembers(): void {},
	getRoomPeer(roomId: string): PlaywrightRoomPeer | null {
		return getConfig()?.roomPeers?.[roomId] ?? null;
	},
	async leaveRoom(): Promise<void> {},
	getUserId(): string {
		return getUserId();
	}
} as unknown as typeof MatrixBackendModule;

export function getPlaywrightBackend(): typeof MatrixBackendModule | null {
	return getConfig()?.enabled ? backend : null;
}
