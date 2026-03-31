import { ClientEventType, type ClientEventType as ClientEventTypeValue } from '$lib/types/events';
import {
	MatrixTimelineType,
	type LocalEcho,
	type NormalizedTimelineEvent
} from '$lib/types/matrix';
import type {
	ActiveCallBannerState,
	GalleryImage,
	LightboxState,
	ReplyTarget
} from '$lib/types/routes';

export type TypingUsers = Record<string, string>;

export interface BackendRoomMessageEvent {
	type?: ClientEventTypeValue;
	room_id?: string;
	roomId?: string;
	room_ext?: string;
	participant_count?: number;
	started_at?: string;
	started_by_name?: string;
}

export interface RoomMemberSummary {
	id: string;
	display_name?: string | null;
}

export interface RoomDetailsSummary {
	members?: RoomMemberSummary[];
	role?: string | null;
	active_call?: ActiveCallBannerState | null;
}

export function buildGalleryImages(messages: NormalizedTimelineEvent[]): GalleryImage[] {
	return messages
		.filter((message) => message.type === MatrixTimelineType.IMAGE && Boolean(message.media?.mxcUrl))
		.map((message) => ({
			mxcUrl: message.media?.mxcUrl || '',
			alt: message.body || ''
		}));
}

export function buildLightboxState(
	mxcUrl: string,
	alt: string,
	gallery: GalleryImage[]
): LightboxState {
	const index = gallery.findIndex((image) => image.mxcUrl === mxcUrl);
	return { mxcUrl, alt, index: index >= 0 ? index : 0 };
}

export function buildTypingLabel(typingUsers: TypingUsers, isGroup: boolean): string {
	if (!isGroup) return '';
	const names = Object.values(typingUsers);
	if (names.length === 0) return '';
	if (names.length === 1) return `${names[0]} is typing...`;
	if (names.length === 2) return `${names[0]}, ${names[1]} are typing...`;
	return `${names[0]}, ${names[1]} + ${names.length - 2} more are typing...`;
}

export function formatMessageTime(iso: string | null | undefined): string {
	if (!iso) return '';
	return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function isMessageReadByPeer(
	message: NormalizedTimelineEvent,
	peerReadTs: number,
	peerReadEventId: string | null
): boolean {
	if (!message.mine) return false;
	if (peerReadEventId && message.id === peerReadEventId) return true;
	return message.ts <= peerReadTs;
}

export function toActiveCallState(event: BackendRoomMessageEvent): ActiveCallBannerState | null {
	if (event.type !== ClientEventType.ROOM_CALL_INVITE && event.type !== ClientEventType.ROOM_CALL_UPDATED) {
		return null;
	}
	return {
		room_name: event.room_ext,
		participant_count: event.participant_count,
		started_at: event.started_at,
		started_by_name: event.started_by_name
	};
}

export function createTextLocalEcho(args: {
	txnId: string;
	roomId: string;
	senderId: string;
	body: string;
	senderName: string;
	replyTarget: ReplyTarget | null;
	now?: number;
}): LocalEcho {
	const now = args.now ?? Date.now();
	return {
		id: `echo:${args.txnId}`,
		txnId: args.txnId,
		roomId: args.roomId,
		senderId: args.senderId,
		body: args.body,
		type: MatrixTimelineType.TEXT,
		media: null,
		mine: true,
		ts: now,
		isoTs: new Date(now).toISOString(),
		senderName: args.senderName,
		replyTo: args.replyTarget
			? {
					eventId: args.replyTarget.id,
					body: args.replyTarget.body,
					senderName: args.replyTarget.senderName
				}
			: null,
		callMeta: null
	};
}
