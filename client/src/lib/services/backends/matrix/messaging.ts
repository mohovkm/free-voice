import {
	normalizeEvent,
	addLocalEcho,
	removeLocalEcho,
	initStore,
	_notify
} from '../../../stores/matrixStore';
import { _client, _pendingConversationListeners, _processedEventIds } from './client';
import { put as mediaCachePut } from '../../mediaCache';
import {
	buildConversationSummaries,
	collectUnreadCounts,
	getLastMessageSummary
} from './conversationSummary';
import {
	MatrixEventType,
	MatrixMembership,
	MatrixMessageType,
	MatrixTimelineType
} from '$lib/types/matrix';
import type {
	ConversationLastMessage,
	ConversationSummary,
	NormalizedTimelineEvent,
	UnreadCountMap
} from '$lib/types/matrix';
import type { MediaMessageType, MediaUploadLimits } from '$lib/types/media';
import type {
	MatrixClientLike,
	MatrixEventLike,
	MatrixRoomLike,
	MatrixRoomMemberLike,
	MatrixTimelineLike,
	MatrixUploadResponse
} from '$lib/types/matrixSdk';

interface MediaUploadResult {
	mxcUrl: string;
	mimeType: string;
	size: number;
	filename: string;
}

interface VideoInfoResult {
	duration: number | null;
	thumbBlob: Blob | null;
}

interface AudioMeta {
	durationSecs: number | null;
	waveformData: number[] | null;
}

let _txnCounter = 0;
const _lastReadReceiptEventKeys = new Map<string, string>();

interface PeerReadMarker {
	ts: number;
	eventId: string | null;
}

export const MEDIA_SIZE_LIMITS: MediaUploadLimits = {
	[MatrixMessageType.IMAGE]: 10 * 1024 * 1024,
	[MatrixMessageType.AUDIO]: 5 * 1024 * 1024,
	[MatrixMessageType.VIDEO]: 25 * 1024 * 1024,
	[MatrixMessageType.FILE]: 15 * 1024 * 1024
};

function getReadReceiptEventKey(event: MatrixEventLike): string {
	const eventId = event.getId?.();
	if (typeof eventId === 'string' && eventId.length > 0) return eventId;
	return `${event.getRoomId?.() || ''}:${event.getTs?.() || 0}`;
}

function isReadReceiptEligibleEvent(event: MatrixEventLike): boolean {
	const eventType = event.getType?.();
	return (
		eventType === MatrixEventType.ROOM_MESSAGE ||
		eventType === MatrixEventType.CALL_INVITE ||
		eventType === MatrixEventType.CALL_HANGUP
	);
}

function getLatestReadableEvent(room: MatrixRoomLike): MatrixEventLike | null {
	const events = room.getLiveTimeline().getEvents();
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index].status || !isReadReceiptEligibleEvent(events[index])) continue;
		return events[index];
	}
	return null;
}

export function _resetReadReceiptTracking(): void {
	_lastReadReceiptEventKeys.clear();
}

function getPeerReadMarker(roomId: string): PeerReadMarker {
	if (!_client) return { ts: 0, eventId: null };
	const room = _client.getRoom(roomId);
	if (!room) return { ts: 0, eventId: null };
	const myUserId = _client.getUserId();
	const joinedMembers =
		room.getJoinedMembers?.() ||
		room
			.currentState?.getMembers?.()
			?.filter((member) => member.membership === MatrixMembership.JOIN) ||
		[];
	const timelineEvents = room.getLiveTimeline?.()?.getEvents?.() || [];
	let latestMarker: PeerReadMarker = { ts: 0, eventId: null };
	for (const member of joinedMembers) {
		if (member.userId === myUserId) continue;
		const eventId = room.getEventReadUpTo?.(member.userId);
		if (!eventId) continue;
		const event =
			room.findEventById?.(eventId) || timelineEvents.find((timelineEvent) => timelineEvent.getId() === eventId);
		if (!event) continue;
		const ts = event.getTs();
		if (ts >= latestMarker.ts) {
			latestMarker = { ts, eventId };
		}
	}
	return latestMarker;
}

function getClient(): MatrixClientLike {
	if (!_client) throw new Error('Matrix client not initialised');
	return _client;
}

export function onConversationsChanged(
	callback: (rooms: ConversationSummary[]) => void
): () => void {
	function emit(): void {
		if (!_client) {
			callback([]);
			return;
		}
		callback(buildConversationSummaries(_client));
	}

	if (_client) {
		_client.on('Room.timeline', emit);
		_client.on('Room', emit);
		_client.on('RoomMember.membership', emit);
		emit();
	} else {
		_pendingConversationListeners.push(emit);
	}

	return () => {
		if (_client) {
			_client.off('Room.timeline', emit);
			_client.off('Room', emit);
			_client.off('RoomMember.membership', emit);
		}
		const index = _pendingConversationListeners.indexOf(emit);
		if (index !== -1) _pendingConversationListeners.splice(index, 1);
	};
}

export function onMembershipChanged(callback: (...args: any[]) => void): () => void {
	if (!_client) return () => {};
	_client.on('Room', callback);
	_client.on('RoomMember.membership', callback);
	return () => {
		_client?.off('Room', callback);
		_client?.off('RoomMember.membership', callback);
	};
}

export function sendMessage(roomId: string, body: string, replyToEventId: string | null = null): string {
	const client = getClient();
	const txnId = `m${Date.now()}.${_txnCounter++}`;
	const content: Record<string, unknown> = { msgtype: MatrixMessageType.TEXT, body };
	if (replyToEventId) {
		content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyToEventId } };
	}
	void client.sendMessage(roomId, content, txnId).catch((error) => {
		console.warn('[matrix] sendMessage failed:', error);
	});
	return txnId;
}

export function getLastMessageBody(roomId: string): ConversationLastMessage {
	if (!_client) return { text: '', msgtype: '' };
	const room = _client.getRoom(roomId);
	if (!room) return { text: '', msgtype: '' };
	return getLastMessageSummary(room);
}

async function waitForRoom(roomId: string): Promise<MatrixRoomLike | null> {
	if (!_client) return null;
	let room = _client.getRoom(roomId);
	if (room) return room;

	room = await new Promise<MatrixRoomLike | null>((resolve) => {
		const timeout = setTimeout(() => {
			_client?.off('Room.timeline', handler);
			resolve(null);
		}, 5000);

		function handler(_event: MatrixEventLike, nextRoom?: MatrixRoomLike): void {
			if (nextRoom?.roomId === roomId) {
				clearTimeout(timeout);
				_client?.off('Room.timeline', handler);
				resolve(_client?.getRoom(roomId) || null);
			}
		}

		_client?.on('Room.timeline', handler);
	});

	return room;
}

function countMessageEvents(timeline: MatrixTimelineLike): number {
	let count = 0;
	for (const event of timeline.getEvents()) {
		if (event.getType() === MatrixEventType.ROOM_MESSAGE) count += 1;
	}
	return count;
}

export async function getHistory(roomId: string, limit = 50): Promise<unknown[]> {
	if (!_client) return [];
	const room = await waitForRoom(roomId);
	if (!room) return [];

	initStore(_client);

	const timeline = room.getLiveTimeline();
	const msgCount = countMessageEvents(timeline);
	let canLoadMoreFromServer = false;
	if (msgCount < limit) {
		try {
			canLoadMoreFromServer = await _client.paginateEventTimeline(timeline, {
				backwards: true,
				limit: limit - msgCount + 10
			});
		} catch (error) {
			console.warn(
				'[matrix] paginateEventTimeline failed (timeline reset?):',
				error instanceof Error ? error.message : error
			);
		}
	}

			const result = room.loadMembersIfNeeded?.();
			if (result && typeof (result as Promise<unknown>).catch === 'function') {
				void (result as Promise<unknown>).catch(() => {});
			}
	_notify();

	const total = countMessageEvents(room.getLiveTimeline());
	return total >= limit || canLoadMoreFromServer ? new Array(limit) : new Array(total);
}

export async function loadMoreHistory(
	roomId: string,
	limit = 50
): Promise<{ canLoadMore: boolean }> {
	if (!_client) return { canLoadMore: false };
	const room = _client.getRoom(roomId);
	if (!room) return { canLoadMore: false };
	let canLoadMore = false;
	try {
		canLoadMore = await _client.paginateEventTimeline(room.getLiveTimeline(), {
			backwards: true,
			limit
		});
	} catch (error) {
		console.warn(
			'[matrix] loadMoreHistory paginateEventTimeline failed:',
			error instanceof Error ? error.message : error
		);
	}
	_notify();
	return { canLoadMore };
}

export function getUnreadCounts(callback: (counts: UnreadCountMap) => void): () => void {
	function emit(): void {
		if (!_client) {
			callback({});
			return;
		}
		callback(collectUnreadCounts(_client));
	}

	if (_client) {
		_client.on('Room.timeline', emit);
		_client.on('Room.receipt', emit);
		_client.on('RoomMember.membership', emit);
		emit();
	}

	return () => {
		_client?.off('Room.timeline', emit);
		_client?.off('Room.receipt', emit);
		_client?.off('RoomMember.membership', emit);
	};
}

export function onMessage(callback: (message: any) => void): () => void {
	if (!_client) return () => {};
	const myUserId = _client.getUserId();

	function handler(
		event: MatrixEventLike,
		room: MatrixRoomLike | null | undefined,
		toStartOfTimeline?: boolean
	): void {
		if (toStartOfTimeline) return;
		if (event.status) return;

		const eventId = event.getId();
		if (!eventId || _processedEventIds.has(eventId)) return;
		_processedEventIds.add(eventId);
		if (_processedEventIds.size > 10000) {
			const oldest = _processedEventIds.values().next().value;
			if (oldest) _processedEventIds.delete(oldest);
		}

		const txnId = event.getUnsignedData?.()?.transaction_id;
		if (typeof txnId === 'string' && txnId.length > 0) {
			removeLocalEcho(event.getRoomId() || '', txnId);
		}
		_notify();
		callback(normalizeEvent(event, myUserId, room || null, _client?.getUser.bind(_client) || null));
	}

	_client.on('Room.timeline', handler);
	return () => _client?.off('Room.timeline', handler);
}

export const VIDEO_MAX_DURATION_SECS = 120;
export const AUDIO_MAX_DURATION_SECS = 120;

export async function extractAudioInfo(file: File): Promise<AudioMeta> {
	const scopedGlobal = globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};
	const AudioCtx =
		typeof AudioContext !== 'undefined'
			? AudioContext
			: typeof scopedGlobal.webkitAudioContext !== 'undefined'
				? scopedGlobal.webkitAudioContext
				: null;
	if (!AudioCtx) return { durationSecs: null, waveformData: null };
	try {
		const ctx = new AudioCtx();
		const arrayBuffer = await file.arrayBuffer();
		const buffer = await ctx.decodeAudioData(arrayBuffer);
		void ctx.close().catch(() => {});
		const durationSecs = isFinite(buffer.duration) ? buffer.duration : null;
		const channelData = buffer.getChannelData(0);
		const bars = 60;
		const step = Math.max(1, Math.floor(channelData.length / bars));
		const waveformData: number[] = [];
		for (let index = 0; index < bars; index += 1) {
			let max = 0;
			const start = index * step;
			const end = Math.min(start + step, channelData.length);
			for (let sample = start; sample < end; sample += 1) {
				const abs = Math.abs(channelData[sample]);
				if (isFinite(abs) && abs > max) max = abs;
			}
			waveformData.push(Math.round(max * 1024));
		}
		return { durationSecs, waveformData };
	} catch {
		return { durationSecs: null, waveformData: null };
	}
}

function extractVideoInfo(file: File): Promise<VideoInfoResult> {
	if (typeof document === 'undefined') return Promise.resolve({ duration: null, thumbBlob: null });
	return new Promise<VideoInfoResult>((resolve) => {
		let settled = false;
		let duration: number | null = null;

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				cleanup();
				resolve({ duration, thumbBlob: null });
			}
		}, 5000);

		const video = document.createElement('video');
		video.muted = true;
		video.playsInline = true;
		video.preload = 'metadata';

		const blobUrl = URL.createObjectURL(file);
		const cleanup = (): void => {
			clearTimeout(timer);
			URL.revokeObjectURL(blobUrl);
		};

		video.addEventListener(
			'loadedmetadata',
			() => {
				duration = isFinite(video.duration) ? video.duration : null;
				video.currentTime = Math.min(0.1, (duration ?? 0) / 2);
			},
			{ once: true }
		);

		video.addEventListener(
			'seeked',
			() => {
				if (settled) return;
				settled = true;
				cleanup();
				const maxW = 320;
				const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
				const width = Math.round(video.videoWidth * scale);
				const height = Math.round(video.videoHeight * scale);
				if (!width || !height) {
					resolve({ duration, thumbBlob: null });
					return;
				}
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
				canvas.toBlob((blob) => resolve({ duration, thumbBlob: blob || null }), 'image/jpeg', 0.8);
			},
			{ once: true }
		);

		video.addEventListener(
			'error',
			() => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve({ duration, thumbBlob: null });
			},
			{ once: true }
		);

		video.src = blobUrl;
	});
}

export async function uploadMedia(file: File): Promise<MediaUploadResult> {
	const client = getClient();
	const response = (await client.uploadContent(file, {
		name: file.name,
		type: file.type,
		onlyContentUri: false
	})) as MatrixUploadResponse;
	return {
		mxcUrl: response.content_uri,
		mimeType: file.type,
		size: file.size,
		filename: file.name
	};
}

export async function sendMediaMessage(
	roomId: string,
	file: File,
	messageType: MediaMessageType,
	replyToEventId: string | null = null,
	audioMeta: AudioMeta | null = null
): Promise<string> {
	const client = getClient();
	const limit = MEDIA_SIZE_LIMITS[messageType];
	if (limit !== undefined && file.size > limit) {
		const limitMB = Math.round(limit / (1024 * 1024));
		throw new Error(
			`File too large (max ${limitMB} MB). For larger files, share a link from a cloud storage service.`
		);
	}

	const myUserId = client.getUserId();
	const txnId = `m${Date.now()}.${_txnCounter++}`;
	const isVideo = messageType === MatrixMessageType.VIDEO;
	const { duration, thumbBlob } = isVideo
		? await extractVideoInfo(file).catch(() => ({ duration: null, thumbBlob: null }))
		: { duration: null, thumbBlob: null };

	if (isVideo && duration !== null && duration > VIDEO_MAX_DURATION_SECS) {
		throw new Error(
			`Video too long (max ${VIDEO_MAX_DURATION_SECS / 60} minutes). Please trim before sending.`
		);
	}

	const audioDuration = audioMeta?.durationSecs ?? null;
	const waveformData = audioMeta?.waveformData ?? null;
	const thumbBlobUrl = thumbBlob ? URL.createObjectURL(thumbBlob) : null;
	const previewUrl =
		file.type.startsWith('image/') ||
		file.type.startsWith('video/') ||
		file.type.startsWith('audio/')
			? URL.createObjectURL(file)
			: null;

	addLocalEcho(roomId, {
		id: `echo:${txnId}`,
		txnId,
		roomId,
		senderId: myUserId,
		senderName: '',
		type:
			messageType === MatrixMessageType.IMAGE
				? MatrixTimelineType.IMAGE
				: messageType === MatrixMessageType.AUDIO
					? MatrixTimelineType.AUDIO
					: messageType === MatrixMessageType.VIDEO
						? MatrixTimelineType.VIDEO
						: MatrixTimelineType.FILE,
		body: file.name,
		media: {
			mxcUrl: previewUrl,
			mimeType: file.type,
			size: file.size,
			filename: file.name,
			thumbnailUrl: thumbBlobUrl,
			durationSecs: audioDuration,
			waveformData
		},
		ts: Date.now(),
		isoTs: new Date().toISOString(),
		mine: true,
		replyTo: null,
		callMeta: null,
		_isLocalEcho: true,
		_blobUrl: previewUrl,
		_thumbBlobUrl: thumbBlobUrl
	});

	try {
		const thumbFile = thumbBlob ? new File([thumbBlob], 'thumb.jpg', { type: 'image/jpeg' }) : null;
		const [{ mxcUrl, mimeType, size, filename }, thumbResult] = await Promise.all([
			uploadMedia(file),
			thumbFile ? uploadMedia(thumbFile).catch(() => null) : Promise.resolve(null)
		]);

		mediaCachePut(mxcUrl, file);
		if (thumbBlob && thumbResult?.mxcUrl) mediaCachePut(thumbResult.mxcUrl, thumbBlob);

		const info: Record<string, unknown> = { mimetype: mimeType, size };
		if (thumbResult?.mxcUrl && thumbBlob) {
			info.thumbnail_url = thumbResult.mxcUrl;
			info.thumbnail_info = { mimetype: 'image/jpeg', size: thumbBlob.size };
		}
		if (audioDuration !== null && isFinite(audioDuration)) {
			info.duration = Math.round(audioDuration * 1000);
		}
		if (waveformData) {
			info.waveform = waveformData;
		}

		const content: Record<string, unknown> = { msgtype: messageType, body: filename, url: mxcUrl, info };
		if (replyToEventId) {
			content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyToEventId } };
		}
		await client.sendMessage(roomId, content, txnId);
	} catch (error) {
		removeLocalEcho(roomId, txnId);
		throw error;
	}

	return txnId;
}

export async function sendReadReceipt(
	roomId: string,
	isAtBottom = true,
	forceResend = false
): Promise<void> {
	if (!_client || !isAtBottom) return;
	const room = _client.getRoom(roomId);
	if (!room) return;
	const latestEvent = getLatestReadableEvent(room);
	if (!latestEvent) return;

	const eventKey = getReadReceiptEventKey(latestEvent);
	if (!forceResend && _lastReadReceiptEventKeys.get(roomId) === eventKey) return;

	_lastReadReceiptEventKeys.set(roomId, eventKey);
	try {
		await _client.sendReadReceipt(latestEvent);
	} catch (error) {
		_lastReadReceiptEventKeys.delete(roomId);
		console.warn('sendReadReceipt: non-critical failure:', error);
	}
}

export function getPeerReadTs(roomId: string): number {
	return getPeerReadMarker(roomId).ts;
}

export function getPeerReadEventId(roomId: string): string | null {
	return getPeerReadMarker(roomId).eventId;
}

export function onReadReceiptChanged(roomId: string, callback: (ts: number) => void): () => void {
	if (!_client) return () => {};
	function handler(_event: unknown, room: MatrixRoomLike): void {
		if (room.roomId !== roomId) return;
		callback(getPeerReadTs(roomId));
	}
	_client.on('Room.receipt', handler);
	return () => _client?.off('Room.receipt', handler);
}

export async function sendTyping(roomId: string, isTyping: boolean): Promise<void> {
	if (!_client) return;
	try {
		await _client.sendTyping(roomId, isTyping, isTyping ? 4000 : undefined);
	} catch (error) {
		console.warn('sendTyping: non-critical failure:', error);
	}
}

export function onTypingChanged(
	roomId: string,
	callback: (payload: { userId: string; typing: boolean }) => void
): () => void {
	if (!_client) return () => {};
	const myUserId = _client.getUserId();
	function handler(_event: unknown, member: MatrixRoomMemberLike): void {
		if (member.roomId !== roomId) return;
		if (member.userId === myUserId) return;
		callback({ userId: member.userId, typing: Boolean(member.typing) });
	}
	_client.on('RoomMember.typing', handler);
	return () => _client?.off('RoomMember.typing', handler);
}
