import { _update } from '../../../stores/call';
import { _client } from './client';
import { CallMode, CallPhase } from '$lib/types/call';
import { ClientEventType, type ClientEventType as ClientEventTypeValue } from '$lib/types/events';
import { MatrixEventType } from '$lib/types/matrix';
import {
	MatrixSyncState,
	type MatrixEventLike,
	type MatrixRoomLike
} from '$lib/types/matrixSdk';

interface MatrixCallSignal {
	type: ClientEventTypeValue;
	room: string;
	call_id?: string;
	caller_email?: string;
	caller_name?: string;
	video?: boolean;
}

interface MatrixCallContent {
	call_id?: string;
	lifetime?: number;
	invitee?: string;
	offer?: {
		sdp?: string;
	};
}

function getCallContent(event: MatrixEventLike): MatrixCallContent {
	return event.getContent() as MatrixCallContent;
}

export async function sendCallInvite(roomId: string, video = true): Promise<string | undefined> {
	if (!_client) return undefined;
	const callId = `${Date.now()}${Math.random().toString(16).slice(2)}`;
	await _client.sendEvent(roomId, MatrixEventType.CALL_INVITE, {
		call_id: callId,
		lifetime: 60000,
		version: '1',
		offer: { type: 'offer', sdp: video ? 'm=video' : '' }
	});
	return callId;
}

export async function sendCallHangup(roomId: string, callId: string | null | undefined): Promise<void> {
	if (!_client || !callId) return;
	await _client
		.sendEvent(roomId, MatrixEventType.CALL_HANGUP, {
			call_id: callId,
			version: '1',
			reason: 'user_hangup'
		})
		.catch(() => {});
}

export function onCallSignal(callback: (signal: MatrixCallSignal) => void): () => void {
	if (!_client) return () => {};
	const myUserId = _client.getUserId();
	const signalledCallIds = new Set<string>();

	function emitInvite(event: MatrixEventLike, room: MatrixRoomLike | null | undefined): void {
		const content = getCallContent(event);
		const callId = content.call_id;
		if (!callId || signalledCallIds.has(callId)) return;
		const lifetime = content.lifetime ?? 60000;
		const localAge = event.getLocalAge?.() ?? 0;
		if (localAge > lifetime - 3000) return;
		if (content.invitee && content.invitee !== myUserId) return;

		signalledCallIds.add(callId);
		const callerId = event.getSender() || '';
		callback({
			type: ClientEventType.CALL_INVITE,
			room: room?.roomId ?? event.getRoomId() ?? '',
			call_id: callId,
			caller_email: callerId,
			caller_name: _client?.getUser(callerId)?.displayName || callerId,
			video: (content.offer?.sdp || '').includes('m=video')
		});
	}

	function timelineHandler(
		event: MatrixEventLike,
		room: MatrixRoomLike | null | undefined,
		toStartOfTimeline?: boolean
	): void {
		if (toStartOfTimeline) return;
		if (event.getSender() === myUserId) return;
		const evType = event.getType();

		if (evType === MatrixEventType.CALL_INVITE) {
			emitInvite(event, room);
			return;
		}
		if (evType === MatrixEventType.CALL_HANGUP) {
			callback({
				type: ClientEventType.CALL_ENDED,
				room: room?.roomId ?? event.getRoomId() ?? ''
			});
		}
	}

	function checkPendingInvites(): void {
		const now = Date.now();
		for (const room of _client?.getRooms() || []) {
			const events = room.getLiveTimeline().getEvents();
			for (let index = events.length - 1; index >= 0; index -= 1) {
				const event = events[index];
				if (event.getType() !== MatrixEventType.CALL_INVITE) continue;
				if (event.getSender() === myUserId) continue;

				const content = getCallContent(event);
				const callId = content.call_id;
				if (!callId || signalledCallIds.has(callId)) continue;

				const age = now - event.getTs();
				const lifetime = content.lifetime ?? 60000;
				if (age > lifetime - 3000) continue;
				if (content.invitee && content.invitee !== myUserId) continue;

				let hungUp = false;
				for (let nextIndex = index + 1; nextIndex < events.length; nextIndex += 1) {
					const nextEvent = events[nextIndex];
					if (
						nextEvent.getType() === MatrixEventType.CALL_HANGUP &&
						getCallContent(nextEvent).call_id === callId
					) {
						hungUp = true;
						break;
					}
				}
				if (hungUp) continue;

				signalledCallIds.add(callId);
				const callerId = event.getSender() || '';
				callback({
					type: ClientEventType.CALL_INVITE,
					room: room.roomId,
					call_id: callId,
					caller_email: callerId,
					caller_name: _client?.getUser(callerId)?.displayName || callerId,
					video: (content.offer?.sdp || '').includes('m=video')
				});
				return;
			}
		}
	}

	function syncHandler(state: string): void {
		if (state === MatrixSyncState.PREPARED) checkPendingInvites();
	}

	checkPendingInvites();
	_client.on('Room.timeline', timelineHandler);
	_client.on('sync', syncHandler);

	return () => {
		if (_client) {
			_client.off('Room.timeline', timelineHandler);
			_client.off('sync', syncHandler);
		}
	};
}

export function notify(message: MatrixCallSignal): void {
	switch (message.type) {
		case ClientEventType.CALL_INVITE:
			_update({
				phase: CallPhase.RINGING_IN,
				roomName: message.room,
				remoteName: message.caller_name || message.caller_email || '',
				video: message.video !== false,
				mode: CallMode.P2P
			});
			break;
	}
}

export async function setCallMember(roomId: string): Promise<void> {
	if (!_client) return;
	const userId = _client.getUserId();
	const deviceId = _client.getDeviceId?.() || '';
	const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
	await _client.sendStateEvent(
		roomId,
		'org.matrix.msc3401.call.member',
		{
			'm.calls': [
				{
					'm.call_id': roomId,
					'm.devices': [{ device_id: deviceId, session_id: sessionId, feeds: [] }]
				}
			]
		},
		userId
	);
}

export async function clearCallMember(roomId: string): Promise<void> {
	if (!_client) return;
	const userId = _client.getUserId();
	try {
		await _client.sendStateEvent(
			roomId,
			'org.matrix.msc3401.call.member',
			{ 'm.calls': [] },
			userId
		);
	} catch (error) {
		console.warn('clearCallMember: failed (may have already left room):', error);
	}
}
