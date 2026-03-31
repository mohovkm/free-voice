import type {
	ConversationLastMessage,
	ConversationSummary,
	UnreadCountMap
} from '$lib/types/matrix';
import {
	MatrixEventType,
	MatrixMembership,
	MatrixMessageType,
	MatrixTimelineType
} from '$lib/types/matrix';
import { MatrixUnreadNotificationKind } from '$lib/types/matrixSdk';
import type {
	MatrixClientLike,
	MatrixEventLike,
	MatrixRoomLike
} from '$lib/types/matrixSdk';

const DIRECT_ACCOUNT_DATA_EVENT = 'm.direct';
const EMPTY_ROOM_NAME_PREFIX = 'Empty room';

export function getLastMessageSummary(room: MatrixRoomLike): ConversationLastMessage {
	const events = room.getLiveTimeline?.()?.getEvents?.() || [];
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (event.status) continue;
		if (event.getType() === MatrixEventType.ROOM_MESSAGE) {
			const content = event.getContent();
			return {
				text: typeof content.body === 'string' ? content.body : '',
				msgtype:
					typeof content.msgtype === 'string'
						? (content.msgtype as ConversationLastMessage['msgtype'])
						: MatrixMessageType.TEXT
			};
		}
		if (
			(event.getType() === MatrixEventType.CALL_INVITE ||
				event.getType() === MatrixEventType.CALL_HANGUP) &&
			typeof event.getContent()?.call_id === 'string'
		) {
			return { text: '', msgtype: MatrixTimelineType.CALL };
		}
	}
	return { text: '', msgtype: '' };
}

function resolveRoomName(client: MatrixClientLike, room: MatrixRoomLike): string {
	const myUserId = client.getUserId();
	const members = room.currentState?.getMembers?.() || [];
	const peer = members.find(
		(member) => member.userId !== myUserId && member.membership === MatrixMembership.JOIN
	);
	if (peer?.name && !peer.name.startsWith('@')) return peer.name;
	if (peer?.userId) {
		const user = client.getUser(peer.userId);
		if (user?.displayName && !user.displayName.startsWith('@')) return user.displayName;
	}
	if (room.name && !room.name.startsWith(EMPTY_ROOM_NAME_PREFIX)) return room.name;
	return room.roomId;
}

export function buildConversationSummaries(client: MatrixClientLike): ConversationSummary[] {
	const dmData = client.getAccountData<Record<string, string[]>>(DIRECT_ACCOUNT_DATA_EVENT)?.getContent() || {};
	const roomToPeer: Record<string, string> = {};
	for (const [peerId, roomIds] of Object.entries(dmData)) {
		for (const roomId of roomIds) roomToPeer[roomId] = peerId;
	}

	const seenPeers = new Set<string>();
	return client
		.getRooms()
		.filter((room) => room.getMyMembership() === MatrixMembership.JOIN)
		.slice()
		.sort(
			(left, right) => (right.getLastActiveTimestamp() || 0) - (left.getLastActiveTimestamp() || 0)
		)
		.filter((room) => {
			const peerId = roomToPeer[room.roomId];
			if (!peerId) return true;
			if (seenPeers.has(peerId)) return false;
			seenPeers.add(peerId);
			return true;
		})
		.map((room) => ({
			roomId: room.roomId,
			name: resolveRoomName(client, room),
			lastActiveTs: room.getLastActiveTimestamp() || 0,
			lastMessage: getLastMessageSummary(room)
		}));
}

export function collectUnreadCounts(client: MatrixClientLike): UnreadCountMap {
	const counts: UnreadCountMap = {};
	client.getRooms().forEach((room) => {
		const total = room.getUnreadNotificationCount(MatrixUnreadNotificationKind.TOTAL);
		const highlight = room.getUnreadNotificationCount(MatrixUnreadNotificationKind.HIGHLIGHT);
		if (total > 0 || highlight > 0) {
			counts[room.roomId] = { total, highlight };
		}
	});
	return counts;
}
