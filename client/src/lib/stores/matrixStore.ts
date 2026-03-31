import { writable, type Readable, type Writable } from 'svelte/store';
import {
	getMatrixCallId,
	normalizeMatrixMediaPayload,
	normalizeReplyPreview
} from '../services/normalizers/matrix';
import {
	MatrixCallDirection,
	MatrixCallStatus,
	MatrixEventType,
	MatrixMembership,
	MatrixMessageType,
	MatrixTimelineType
} from '$lib/types/matrix';
import type {
	ConversationLastMessage,
	LocalEcho,
	MatrixMediaPayload,
	NormalizedTimelineEvent
} from '$lib/types/matrix';
import type {
	MatrixClientLike,
	MatrixEventLike,
	MatrixRoomLike,
	MatrixUserLike
} from '$lib/types/matrixSdk';

export type MediaInfo = MatrixMediaPayload;

const _localEchoes = new Map<string, LocalEcho>();
const _echosByRoom = new Map<string, string[]>();

let _sdkClient: MatrixClientLike | null = null;

export const _tick: Writable<number> = writable(0);

export function _notify(): void {
	_tick.update((count) => count + 1);
}

export function initStore(client: MatrixClientLike | null): void {
	_sdkClient = client;
}

function _resolveType(
	evType: string,
	msgtype: string | null,
	content: Record<string, unknown>
): NormalizedTimelineEvent['type'] {
	if (evType === MatrixEventType.CALL_INVITE || evType === MatrixEventType.CALL_HANGUP) {
		return typeof content.call_id === 'string' && content.call_id.length > 0
			? MatrixTimelineType.CALL
			: MatrixTimelineType.SYSTEM;
	}
	if (evType !== MatrixEventType.ROOM_MESSAGE) return MatrixTimelineType.SYSTEM;
	switch (msgtype) {
		case MatrixMessageType.IMAGE:
			return MatrixTimelineType.IMAGE;
		case MatrixMessageType.AUDIO:
			return MatrixTimelineType.AUDIO;
		case MatrixMessageType.VIDEO:
			return MatrixTimelineType.VIDEO;
		case MatrixMessageType.FILE:
			return MatrixTimelineType.FILE;
		default:
			return MatrixTimelineType.TEXT;
	}
}

function _resolveMedia(content: Record<string, unknown>, msgtype: string | null): MatrixMediaPayload | null {
	return normalizeMatrixMediaPayload(content, msgtype);
}

function _stateBody(event: MatrixEventLike): string {
	const type = event.getType();
	const content = event.getContent();
	const sender = event.getSender() || '';
	if (type === MatrixEventType.ROOM_MEMBER) {
		const displayName = typeof content.displayname === 'string' ? content.displayname : sender;
		const membership = typeof content.membership === 'string' ? content.membership : '';
		if (membership === MatrixMembership.JOIN) return `${displayName} joined`;
		if (membership === MatrixMembership.LEAVE) return `${displayName} left`;
		if (membership === MatrixMembership.INVITE) return `${displayName} was invited`;
		return `${displayName} membership: ${membership}`;
	}
	if (type === MatrixEventType.ROOM_NAME) {
		return `Room renamed to "${typeof content.name === 'string' ? content.name : ''}"`;
	}
	if (type === MatrixEventType.CALL_INVITE) return 'Call started';
	if (type === MatrixEventType.CALL_HANGUP) return 'Call ended';
	return type;
}

export function normalizeEvent(
	event: MatrixEventLike,
	myUserId: string | null,
	room: MatrixRoomLike | null,
	getUser: ((userId: string) => MatrixUserLike | null | undefined) | null = null
): NormalizedTimelineEvent {
	const evType = event.getType();
	const content = event.getContent();
	const msgtype = typeof content.msgtype === 'string' ? content.msgtype : null;
	const isMessage = evType === MatrixEventType.ROOM_MESSAGE;
	const senderId = event.getSender();
	const senderName =
		(typeof event.sender?.name === 'string' && event.sender.name) ||
		getUser?.(senderId)?.displayName ||
		senderId ||
		'';
	const txnId = event.getUnsignedData?.()?.transaction_id;
	const ts = event.getTs();

	return {
		id: event.getId(),
		roomId: event.getRoomId(),
		senderId,
		senderName,
		type: _resolveType(evType, msgtype, content),
		body: isMessage ? (typeof content.body === 'string' ? content.body : '') : _stateBody(event),
		media: _resolveMedia(content, msgtype),
		ts,
		isoTs: new Date(ts).toISOString(),
		mine: senderId === myUserId,
		txnId: typeof txnId === 'string' ? txnId : null,
		replyTo: normalizeReplyPreview(content, room),
		callMeta: null
	};
}

function _getLocalEchoes(roomId: string): LocalEcho[] {
	const echoes = _echosByRoom.get(roomId) || [];
	return echoes
		.map((txnId) => _localEchoes.get(txnId))
		.filter((echo): echo is LocalEcho => Boolean(echo));
}

export function readTimeline(roomId: string): NormalizedTimelineEvent[] {
	if (!_sdkClient) return _getLocalEchoes(roomId);
	const room = _sdkClient.getRoom(roomId);
	if (!room) return _getLocalEchoes(roomId);

	const myUserId = _sdkClient.getUserId();
	const sdkEvents = room.getLiveTimeline().getEvents();
	const confirmedIds = new Set<string>();
	const result: NormalizedTimelineEvent[] = [];
	const callInvites = new Map<string, MatrixEventLike>();
	const callHangups = new Map<string, MatrixEventLike>();

	for (const event of sdkEvents) {
		if (event.status) continue;
		const evType = event.getType();
		const callId = getMatrixCallId(event.getContent?.());
		if (!callId) continue;
		if (evType === MatrixEventType.CALL_INVITE) callInvites.set(callId, event);
		else if (evType === MatrixEventType.CALL_HANGUP) callHangups.set(callId, event);
	}

	for (const event of sdkEvents) {
		const evType = event.getType();
		if (event.status) continue;
		if (
			evType !== MatrixEventType.ROOM_MESSAGE &&
			evType !== MatrixEventType.ROOM_MEMBER &&
			evType !== MatrixEventType.ROOM_NAME &&
			evType !== MatrixEventType.CALL_INVITE &&
			evType !== MatrixEventType.CALL_HANGUP
		) {
			continue;
		}

		const callId = getMatrixCallId(event.getContent?.());
		if (evType === MatrixEventType.CALL_INVITE && callId && callHangups.has(callId)) continue;

		const normalized = normalizeEvent(event, myUserId, room, _sdkClient.getUser.bind(_sdkClient));

		if (normalized.type === MatrixTimelineType.CALL && callId) {
			const invite = callInvites.get(callId);
			const hangup = callHangups.get(callId);
			const direction =
				invite !== undefined
					? invite.getSender() === myUserId
						? MatrixCallDirection.OUTGOING
						: MatrixCallDirection.INCOMING
					: event.getSender() === myUserId
						? MatrixCallDirection.OUTGOING
						: MatrixCallDirection.INCOMING;

			if (hangup && invite) {
				const durationMs = hangup.getTs() - invite.getTs();
				const durationSecs = Math.max(0, Math.round(durationMs / 1000));
				normalized.callMeta = {
					direction,
					status: MatrixCallStatus.ANSWERED,
					durationSecs
				};
			} else {
				normalized.callMeta = {
					direction,
					status: MatrixCallStatus.RINGING,
					durationSecs: null
				};
			}
		}

		if (normalized.txnId) confirmedIds.add(normalized.txnId);
		result.push(normalized);
	}

	const echoes = _echosByRoom.get(roomId) || [];
	for (const txnId of echoes) {
		if (confirmedIds.has(txnId)) continue;
		const echo = _localEchoes.get(txnId);
		if (echo) result.push(echo);
	}

	return result;
}

export function addLocalEcho(roomId: string, localEcho: LocalEcho): void {
	_localEchoes.set(localEcho.txnId, { ...localEcho, _isLocalEcho: true });
	if (!_echosByRoom.has(roomId)) _echosByRoom.set(roomId, []);
	_echosByRoom.get(roomId)?.push(localEcho.txnId);
	_notify();
}

export function removeLocalEcho(roomId: string, txnId: string): void {
	if (!_localEchoes.has(txnId)) return;
	const echo = _localEchoes.get(txnId);
	if (echo?._blobUrl) URL.revokeObjectURL(echo._blobUrl);
	if (echo?._thumbBlobUrl) URL.revokeObjectURL(echo._thumbBlobUrl);
	_localEchoes.delete(txnId);
	const echoes = _echosByRoom.get(roomId);
	if (echoes) {
		const index = echoes.indexOf(txnId);
		if (index !== -1) echoes.splice(index, 1);
	}
	_notify();
}

export function messagesFor(roomId: string): Readable<NormalizedTimelineEvent[]> {
	return {
		subscribe(run) {
			run(readTimeline(roomId));
			return _tick.subscribe(() => run(readTimeline(roomId)));
		}
	};
}

export function lastMessageFor(roomId: string): Readable<ConversationLastMessage> {
	return {
		subscribe(run) {
			function emit(): void {
				if (!_sdkClient) {
					run({ text: '', msgtype: '' });
					return;
				}
				const room = _sdkClient.getRoom(roomId);
				if (!room) {
					run({ text: '', msgtype: '' });
					return;
				}
				const events = room.getLiveTimeline().getEvents();
				for (let index = events.length - 1; index >= 0; index -= 1) {
					const event = events[index];
					if (event.status) continue;
					if (event.getType() === MatrixEventType.ROOM_MESSAGE) {
						const content = event.getContent();
						run({
							text: typeof content.body === 'string' ? content.body : '',
							msgtype:
								typeof content.msgtype === 'string'
									? (content.msgtype as ConversationLastMessage['msgtype'])
									: MatrixMessageType.TEXT
						});
						return;
					}
					if (
						(event.getType() === MatrixEventType.CALL_INVITE ||
							event.getType() === MatrixEventType.CALL_HANGUP) &&
						typeof event.getContent()?.call_id === 'string'
					) {
						run({ text: '', msgtype: MatrixTimelineType.CALL });
						return;
					}
				}
				run({ text: '', msgtype: '' });
			}

			emit();
			return _tick.subscribe(emit);
		}
	};
}

export function resetStore(): void {
	_localEchoes.clear();
	_echosByRoom.clear();
	_sdkClient = null;
	_notify();
}

export function ingestEvent(): boolean {
	return true;
}

export function prependEvents(): void {}
