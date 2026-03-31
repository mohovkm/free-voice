/**
 * callSession.ts — Call state machine. Single owner of all call lifecycle logic.
 * See openspec/specs/call-state-machine/spec.md for the full spec.
 */
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { callStore, _update, _reset, CallEndReason } from '../stores/call';
import { post } from '../services/api';
import {
	setCallMember,
	clearCallMember,
	getAccessToken,
	sendCallInvite,
	sendCallHangup
} from './backends/matrix';
import { CallMode, CallPhase } from '$lib/types/call';
import { ClientEventType, type ClientEventType as ClientEventTypeValue } from '$lib/types/events';

interface LiveKitTrackLike {
	kind: string;
	attach(element: HTMLMediaElement): void;
}

interface LiveKitTrackPublicationLike {
	track?: LiveKitTrackLike | null;
	isSubscribed?: boolean;
	kind?: string;
}

interface LiveKitParticipantLike {
	trackPublications: Map<string, LiveKitTrackPublicationLike>;
}

interface LiveKitLocalParticipantLike extends LiveKitParticipantLike {
	setMicrophoneEnabled(enabled: boolean): Promise<void>;
	setCameraEnabled(enabled: boolean): Promise<void>;
	enableCameraAndMicrophone(): Promise<void>;
}

interface LiveKitRoomLike {
	on(event: string, handler: (...args: unknown[]) => void): LiveKitRoomLike;
	connect(url: string, token: string): Promise<void>;
	disconnect(): Promise<void>;
	removeAllListeners(): void;
	startAudio(): Promise<void>;
	localParticipant: LiveKitLocalParticipantLike;
	remoteParticipants: Map<string, LiveKitParticipantLike>;
}

interface LiveKitModuleLike {
	Room: new () => LiveKitRoomLike;
	RoomEvent: Record<string, string>;
	Track: {
		Kind: {
			Audio: string;
			Video: string;
		};
	};
}

interface StartLivekitOptions {
	roomId: string;
	roomIdForToken?: string;
	video: boolean;
}

type PendingInviteId = string | null;
type CallStartedAt = string | null;

interface CallSignalMessage {
	type: ClientEventTypeValue;
	room?: string;
	room_id?: string;
	room_name?: string;
	room_ext?: string;
	started_at?: string;
	started_by_name?: string;
	participant_count?: number;
	call_id?: string;
	caller_name?: string;
	caller_email?: string;
	video?: boolean;
	session_id?: string;
	device_id?: string;
	from?: string;
}

interface CallActionResult {
	navigateTo: string | null;
}

const LiveKitTrackKind = Object.freeze({
	AUDIO: 'audio',
	VIDEO: 'video'
} as const);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function hasDetail(value: unknown): value is { detail: string } {
	return (
		value !== null &&
		typeof value === 'object' &&
		'detail' in value &&
		typeof (value as { detail?: unknown }).detail === 'string'
	);
}

// ── LiveKit singleton ──────────────────────────────────────────────────────
let _livekitRoom: LiveKitRoomLike | null = null;

// ── Media elements ─────────────────────────────────────────────────────────
let _remoteAudio: HTMLMediaElement | null = null;
let _remoteVideo: HTMLMediaElement | null = null;
let _localVideo: HTMLMediaElement | null = null;

const _clientSessionId =
	globalThis.crypto?.randomUUID?.() ||
	`call-session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ── Timers ─────────────────────────────────────────────────────────────────
let _ringTimer: ReturnType<typeof setTimeout> | null = null;
let _endTimer: ReturnType<typeof setTimeout> | null = null;
let _participantPollTimer: ReturnType<typeof setInterval> | null = null;
let _pendingCallId: PendingInviteId = null; // outgoing m.call.invite call_id for cancellation
const _dismissedRoomInvites = new Map<string, string>();

// ── Tones ──────────────────────────────────────────────────────────────────
let _tone: HTMLAudioElement | null = null;
function _playTone(src: string): void {
	_stopTone();
	_tone = new Audio(src);
	_tone.loop = true;
	_tone.play().catch((err) => console.warn('[callSession]', err));
}
function _stopTone(): void {
	if (_tone) {
		_tone.pause();
		_tone = null;
	}
}

// ── State helpers ──────────────────────────────────────────────────────────
function _phase(): CallPhase {
	return get(callStore).phase;
}
function _roomName(): string | null {
	return get(callStore).roomName;
}

function _end(endReason: (typeof CallEndReason)[keyof typeof CallEndReason]): void {
	_stopTone();
	if (_ringTimer) {
		clearTimeout(_ringTimer);
		_ringTimer = null;
	}
	_update({ phase: CallPhase.ENDED, endReason });
	_endTimer = setTimeout(() => {
		_cleanup();
		_reset();
		goto(resolve('/'));
	}, 2500);
}

function _cleanup(): void {
	if (_participantPollTimer) {
		clearInterval(_participantPollTimer);
		_participantPollTimer = null;
	}
	if (_livekitRoom) {
		_cleanupLivekit();
		return;
	}
	if (_remoteVideo) {
		_remoteVideo.srcObject = null;
	}
	if (_localVideo) {
		_localVideo.srcObject = null;
	}
	if (_remoteAudio) {
		_remoteAudio.srcObject = null;
	}
	_remoteAudio = _remoteVideo = _localVideo = null;
}

// ── LiveKit helpers ────────────────────────────────────────────────────────
async function _getLivekitToken(roomId: string): Promise<{ token: string; url: string }> {
	// The livekit-token endpoint validates against the Matrix homeserver,
	// so we must send the Matrix access token, not the app JWT.
	const matrixToken = getAccessToken() || localStorage.getItem('matrix_access_token');
	if (!matrixToken) throw new Error('No Matrix access token available');
	const r = await fetch('/api/livekit-token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: 'Bearer ' + matrixToken
		},
		body: JSON.stringify({ room_name: roomId })
	});
	if (!r.ok) throw new Error('livekit-token request failed: ' + r.status);
	return (await r.json()) as { token: string; url: string };
}

function _updateLivekitParticipants(): void {
	if (!_livekitRoom) return;
	const count = _livekitRoom.remoteParticipants.size + 1;
	_update({
		participantCount: count,
		waitingForOthers: count <= 1,
		participantLabel: count > 1 ? `${count} participants` : ''
	});
}

function _cleanupLivekit(): void {
	if (_livekitRoom) {
		_livekitRoom.removeAllListeners();
		_livekitRoom.disconnect().catch((err) => console.warn('[callSession]', err));
		_livekitRoom = null;
	}
	if (_remoteAudio) _remoteAudio.srcObject = null;
	if (_remoteVideo) _remoteVideo.srcObject = null;
	if (_localVideo) _localVideo.srcObject = null;
	_remoteAudio = _remoteVideo = _localVideo = null;
}

async function _startLivekit({ roomId, roomIdForToken, video }: StartLivekitOptions): Promise<void> {
	const { Room, RoomEvent, Track } = (await import('livekit-client')) as unknown as LiveKitModuleLike;
	_livekitRoom = new Room();
	_livekitRoom.on(RoomEvent.Disconnected, () => {
		if (_phase() !== CallPhase.ENDED) _end(CallEndReason.REMOTE_HANGUP);
	});
	// iOS backgrounds the app → LiveKit enters reconnecting. Reflect in UI without ending call.
	_livekitRoom.on(RoomEvent.Reconnecting, () => {
		if (_phase() === CallPhase.CONNECTED) _update({ phase: CallPhase.RECONNECTING });
	});
	// LiveKit recovered → restore phase and unblock iOS AudioContext (killed on background).
	_livekitRoom.on(RoomEvent.Reconnected, () => {
		if (_phase() === CallPhase.RECONNECTING) _update({ phase: CallPhase.CONNECTED });
		_livekitRoom?.startAudio().catch(() => {});
	});
	_livekitRoom.on(RoomEvent.ParticipantConnected, () => {
		if (_phase() === CallPhase.RINGING_OUT) {
			_stopTone();
			_update({ phase: CallPhase.CONNECTED });
		}
		_updateLivekitParticipants();
	});
	_livekitRoom.on(RoomEvent.ParticipantDisconnected, () => {
		_updateLivekitParticipants();
		if (_livekitRoom && _livekitRoom.remoteParticipants.size === 0 && _phase() === CallPhase.CONNECTED) {
			_end(CallEndReason.REMOTE_HANGUP);
		}
	});
	_livekitRoom.on(RoomEvent.TrackSubscribed, (track) => {
		const subscribedTrack = track as LiveKitTrackLike;
		if (subscribedTrack.kind === Track.Kind.Audio && _remoteAudio) subscribedTrack.attach(_remoteAudio);
		if (subscribedTrack.kind === Track.Kind.Video && _remoteVideo) subscribedTrack.attach(_remoteVideo);
	});
	_livekitRoom.on(RoomEvent.LocalTrackPublished, (pub) => {
		const publication = pub as LiveKitTrackPublicationLike;
		if (publication.kind === Track.Kind.Video && publication.track && _localVideo) {
			publication.track.attach(_localVideo);
		}
	});

	// Run enableCameraAndMicrophone, token fetch, and connect ALL in parallel.
	// enableCameraAndMicrophone calls getUserMedia immediately (gesture context preserved)
	// and queues publishTrack until signal connection is ready.
	const mediaPromise = (async () => {
		try {
			if (video) {
				await _livekitRoom?.localParticipant.enableCameraAndMicrophone();
			} else {
				await _livekitRoom?.localParticipant.setMicrophoneEnabled(true);
			}
		} catch (error) {
			console.warn('[livekit] enableCameraAndMicrophone failed:', errorMessage(error));
		}
	})();

	const { token, url } = await _getLivekitToken(roomIdForToken || roomId);

	await Promise.all([_livekitRoom.connect(url, token), mediaPromise]);

	// Attach tracks already published by participants who joined before us
	for (const participant of _livekitRoom.remoteParticipants.values()) {
		for (const pub of participant.trackPublications.values()) {
			if (!pub.track || !pub.isSubscribed) continue;
			if (pub.kind === Track.Kind.Audio && _remoteAudio) pub.track.attach(_remoteAudio);
			if (pub.kind === Track.Kind.Video && _remoteVideo) pub.track.attach(_remoteVideo);
		}
	}

	if (_phase() !== CallPhase.RINGING_OUT) {
		_update({ phase: CallPhase.CONNECTED, roomName: roomId });
	}
	_livekitRoom.startAudio().catch(() => {});
	_updateLivekitParticipants();
	setCallMember(roomId).catch((error) => console.warn('[livekit] setCallMember failed:', errorMessage(error)));
}

// Restore iOS AudioContext after app returns to foreground. Safe to call at any time.
export function resumeAudio(): void {
	_livekitRoom?.startAudio().catch(() => {});
}

export function setMediaElements(
	remoteAudio: HTMLMediaElement | null,
	remoteVideo: HTMLMediaElement | null,
	localVideo: HTMLMediaElement | null
): void {
	_remoteAudio = remoteAudio;
	_remoteVideo = remoteVideo;
	_localVideo = localVideo;
	// Re-attach any tracks that arrived before media elements were ready
	if (_livekitRoom) {
		for (const participant of _livekitRoom.remoteParticipants.values()) {
			for (const pub of participant.trackPublications.values()) {
				if (!pub.track || !pub.isSubscribed) continue;
				if (pub.kind === LiveKitTrackKind.AUDIO && _remoteAudio) pub.track.attach(_remoteAudio);
				if (pub.kind === LiveKitTrackKind.VIDEO && _remoteVideo) pub.track.attach(_remoteVideo);
			}
		}
		// Re-attach local video
		if (_localVideo) {
			for (const pub of _livekitRoom.localParticipant.trackPublications.values()) {
				if (pub.kind === LiveKitTrackKind.VIDEO && pub.track) pub.track.attach(_localVideo);
			}
		}
	}
}

export function getClientSessionId(): string {
	return _clientSessionId;
}

export function dismissRoomInvite(roomId: string | null | undefined, startedAt: CallStartedAt | undefined): void {
	if (roomId && startedAt) _dismissedRoomInvites.set(roomId, startedAt);
}

function _isRoomInviteDismissed(roomId: string | null | undefined, startedAt: CallStartedAt | undefined): boolean {
	if (!roomId || !startedAt) return false;
	return _dismissedRoomInvites.get(roomId) === startedAt;
}

export async function dial(roomId: string, video = true): Promise<void> {
	if (_phase() !== CallPhase.IDLE) return;
	_update({ phase: CallPhase.ACQUIRING_MEDIA, video, mode: CallMode.P2P, roomId });
	try {
		_pendingCallId = (await sendCallInvite(roomId, video)) ?? null;
		_update({ phase: CallPhase.RINGING_OUT, roomName: roomId });
		_playTone('/sounds/ringback.mp3');
		await _startLivekit({ roomId, video });
		_ringTimer = setTimeout(() => {
			sendCallHangup(roomId, _pendingCallId);
			_pendingCallId = null;
			_end(CallEndReason.NO_ANSWER);
		}, 30000);
	} catch (error) {
		console.error('[livekit-dial] error:', errorMessage(error));
		_end(CallEndReason.ERROR);
	}
}

export async function answer(roomName: string, video = true): Promise<void> {
	if (_phase() !== CallPhase.RINGING_IN) return;
	_stopTone();
	const roomId = roomName;
	_update({ phase: CallPhase.ACQUIRING_MEDIA, video, roomName, roomId });
	try {
		await _startLivekit({ roomId, video });
	} catch (error) {
		console.error('[livekit-answer] error:', errorMessage(error));
		_end(CallEndReason.ERROR);
	}
}

export async function joinRoom(roomId: string): Promise<void> {
	if (_phase() !== CallPhase.IDLE) return;
	_update({
		phase: CallPhase.ACQUIRING_MEDIA,
		mode: CallMode.ROOM,
		video: true,
		roomId,
		participantCount: 0,
		participantLabel: '',
		waitingForOthers: true
	});
	try {
		await _startLivekit({ roomId, video: true });
	} catch (error) {
		console.error('[livekit] joinRoom error:', errorMessage(error));
		_end(CallEndReason.ERROR);
	}
}

export async function joinAsGuest(slug: string, name: string): Promise<void> {
	if (_phase() !== CallPhase.IDLE) return;
	_update({ phase: CallPhase.ACQUIRING_MEDIA, mode: CallMode.GUEST, video: true, remoteName: name });
	try {
		const data = await post('/links/' + slug + '/join', { display_name: name });
		if (hasDetail(data)) throw new Error(data.detail);
		// Guest join via SIP is no longer supported — end with error
		_end(CallEndReason.ERROR);
	} catch (error) {
		console.warn(error);
		_end(CallEndReason.ERROR);
	}
}

export function decline(roomName: string): void {
	if (_phase() !== CallPhase.RINGING_IN) return;
	void roomName;
	_stopTone();
	_end(CallEndReason.DECLINED);
}

export function cancel(): void {
	const phase = _phase();
	if (phase === CallPhase.RINGING_OUT) {
		const roomId = get(callStore).roomId;
		if (roomId && _pendingCallId) {
			sendCallHangup(roomId, _pendingCallId);
			_pendingCallId = null;
		}
		_end(CallEndReason.CANCELLED);
	} else if (phase !== CallPhase.IDLE && phase !== CallPhase.ENDED) {
		hangup();
	}
}

export function hangup(): void {
	const phase = _phase();
	if (phase === CallPhase.RINGING_OUT) {
		cancel();
		return;
	}
	if (phase === CallPhase.IDLE || phase === CallPhase.ENDED) return;
	const roomId = get(callStore).roomId || _roomName();
	const mode = get(callStore).mode;
	// Send m.call.hangup for P2P calls so remote party is notified via Matrix
	// even if LiveKit disconnect doesn't propagate (iOS background kill)
	if (mode === CallMode.P2P && roomId && _pendingCallId) {
		sendCallHangup(roomId, _pendingCallId);
		_pendingCallId = null;
	}
	if (_livekitRoom) {
		if (roomId) clearCallMember(roomId).catch((err) => console.warn('[callSession]', err));
		_cleanupLivekit();
	}
	_end(CallEndReason.HANGUP);
}

export function toggleMic(): void {
	const isMuted = !get(callStore).micMuted;
	_update({ micMuted: isMuted });
	if (_livekitRoom) {
		_livekitRoom.localParticipant
			.setMicrophoneEnabled(!isMuted)
			.catch((err) => console.warn('[callSession]', err));
	}
}

export function toggleCam(): void {
	const isCamOff = !get(callStore).camOff;
	_update({ camOff: isCamOff });
	if (_livekitRoom) {
		_livekitRoom.localParticipant
			.setCameraEnabled(!isCamOff)
			.catch((err) => console.warn('[callSession]', err));
	}
}

export function notify(msg: CallSignalMessage): CallActionResult | void {
	const phase = _phase();
	const room = _roomName();
	const currentRoomId = get(callStore).roomId;

	if (msg.room && room && msg.room !== room) return;
	if (
		msg.room_id &&
		currentRoomId &&
		msg.room_id !== currentRoomId &&
		msg.type !== ClientEventType.ROOM_CALL_INVITE
	) {
		return;
	}

	switch (msg.type) {
		case ClientEventType.CALL_INVITE:
			_pendingCallId = msg.call_id || null;
			_update({
				phase: CallPhase.RINGING_IN,
				roomName: msg.room ?? null,
				roomId: msg.room ?? null,
				remoteName: msg.caller_name || msg.caller_email || '',
				video: msg.video !== false,
				mode: CallMode.P2P
			});
			_playTone('/sounds/ringtone.mp3');
			break;
		case ClientEventType.ROOM_CALL_INVITE:
			if (_isRoomInviteDismissed(msg.room_id, msg.started_at)) return { navigateTo: null };
			if (phase !== CallPhase.IDLE && phase !== CallPhase.ENDED) return { navigateTo: null };
			_update({
				phase: CallPhase.RINGING_IN,
				roomId: msg.room_id ?? null,
				roomName: msg.room_ext ?? null,
				remoteName: msg.room_name || '',
				video: msg.video !== false,
				mode: CallMode.ROOM,
				callStartedAt: msg.started_at ?? null,
				participantCount: msg.participant_count || 1,
				waitingForOthers: false,
				participantLabel: msg.started_by_name || ''
			});
			_playTone('/sounds/ringtone.mp3');
			return {
				navigateTo: `/call/incoming/room/${encodeURIComponent(msg.room_id ?? '')}?name=${encodeURIComponent(msg.room_name || '')}&started_at=${encodeURIComponent(msg.started_at || '')}`
			};
		case ClientEventType.ROOM_CALL_UPDATED:
			if (msg.room_id !== currentRoomId) return { navigateTo: null };
			_update({
				callStartedAt: msg.started_at || get(callStore).callStartedAt,
				participantCount: msg.participant_count || get(callStore).participantCount
			});
			break;
		case ClientEventType.ROOM_CALL_ENDED:
			if (msg.room_id) _dismissedRoomInvites.delete(msg.room_id);
			if (msg.room_id !== currentRoomId) return { navigateTo: null };
			if (phase === CallPhase.RINGING_IN && get(callStore).mode === CallMode.ROOM) {
				_stopTone();
				_end(CallEndReason.CANCELLED);
				return { navigateTo: `/room/${encodeURIComponent(msg.room_id ?? '')}` };
			}
			if (
				(phase === CallPhase.CONNECTED ||
					phase === CallPhase.CONNECTING ||
					phase === CallPhase.RECONNECTING) &&
				get(callStore).mode === CallMode.ROOM
			) {
				_end(CallEndReason.REMOTE_HANGUP);
			}
			break;
		case ClientEventType.CALL_DECLINE:
			if (phase === CallPhase.RINGING_OUT) _end(CallEndReason.DECLINED);
			break;
		case ClientEventType.CALL_CANCEL:
			if (phase === CallPhase.RINGING_IN) {
				_stopTone();
				_end(CallEndReason.CANCELLED);
			}
			break;
		case ClientEventType.CALL_ENDED:
			if (phase === CallPhase.RINGING_IN) {
				_stopTone();
				_end(CallEndReason.CANCELLED);
				break;
			}
			if (
				phase === CallPhase.CONNECTED ||
				phase === CallPhase.CONNECTING ||
				phase === CallPhase.RECONNECTING
			) {
				_end(CallEndReason.REMOTE_HANGUP);
			}
			break;
		case ClientEventType.CALL_ANSWERED:
			if (phase === CallPhase.RINGING_IN) {
				if (msg.session_id && msg.session_id === _clientSessionId) return;
				if (msg.session_id || msg.device_id) {
					_stopTone();
					_end(CallEndReason.ANSWERED_ELSEWHERE);
				}
			}
			break;
		default:
			console.warn('[callSession] unknown message type:', msg.type);
	}
}
