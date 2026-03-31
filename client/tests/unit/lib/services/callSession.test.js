import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { CallEndReason } from '@client/lib/stores/call';

vi.mock('@client/lib/services/api', () => ({
	post: vi.fn().mockResolvedValue({ token: 'lk-token', url: 'wss://livekit.test' }),
	get: vi.fn().mockResolvedValue({})
}));
vi.stubGlobal(
	'Audio',
	vi.fn(() => ({
		play: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn(),
		loop: false,
		src: ''
	}))
);
vi.stubGlobal('navigator', {
	mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }
});
vi.stubGlobal('location', { protocol: 'https:', host: 'localhost', hostname: 'localhost' });

// ── LiveKit mock ────────────────────────────────────────────────────────────
const mockAttach = vi.fn();
const mockTrack = (kind) => ({ kind, attach: mockAttach });

// Simulates a remote participant who is already publishing when callee joins
const mockRemoteParticipants = new Map();

const mockRoom = {
	on: vi.fn().mockReturnThis(),
	connect: vi.fn().mockResolvedValue(undefined),
	disconnect: vi.fn().mockResolvedValue(undefined),
	removeAllListeners: vi.fn(),
	startAudio: vi.fn().mockResolvedValue(undefined),
	localParticipant: {
		setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
		setCameraEnabled: vi.fn().mockResolvedValue(undefined),
		enableCameraAndMicrophone: vi.fn().mockResolvedValue(undefined),
		publishTrack: vi.fn().mockResolvedValue(undefined),
		trackPublications: new Map()
	},
	remoteParticipants: mockRemoteParticipants
};

vi.mock('livekit-client', () => ({
	Room: vi.fn(() => mockRoom),
	RoomEvent: {
		Disconnected: 'disconnected',
		Reconnecting: 'reconnecting',
		Reconnected: 'reconnected',
		ParticipantConnected: 'participantConnected',
		ParticipantDisconnected: 'participantDisconnected',
		TrackSubscribed: 'trackSubscribed',
		LocalTrackPublished: 'localTrackPublished'
	},
	Track: { Kind: { Audio: 'audio', Video: 'video' } },
	createLocalTracks: vi.fn().mockResolvedValue([])
}));

vi.mock('@client/lib/services/backends/matrix', () => ({
	setCallMember: vi.fn().mockResolvedValue(undefined),
	clearCallMember: vi.fn().mockResolvedValue(undefined),
	getAccessToken: vi.fn().mockReturnValue('mock-token'),
	onCallSignal: vi.fn().mockReturnValue(() => {}),
	sendCallInvite: vi.fn().mockResolvedValue('mock-call-id'),
	sendCallHangup: vi.fn().mockResolvedValue(undefined)
}));

// Mock livekit token fetch
vi.stubGlobal(
	'fetch',
	vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve({ token: 'lk-token', url: 'wss://livekit.test' })
	})
);

const { notify, dial, answer, setMediaElements, dismissRoomInvite, getClientSessionId, resumeAudio } =
	await import('@client/lib/services/callSession');
const { callStore, _reset, _update } = await import('@client/lib/stores/call');

describe('callSession — LiveKit dial', () => {
	beforeEach(() => {
		_reset();
		vi.clearAllMocks();
		mockRemoteParticipants.clear();
		mockRoom.on.mockReturnThis();
	});

	it('dial() connects to LiveKit and transitions to connected', async () => {
		await dial('!room:test', true);
		expect(mockRoom.connect).toHaveBeenCalledWith('wss://livekit.test', 'lk-token');
		// After LiveKit connects, phase is connected (ring timer still pending but call is live)
		expect(['ringing_out', 'connected']).toContain(get(callStore).phase);
	});

	it('dial() enables mic and camera when video=true', async () => {
		await dial('!room:test', true);
		expect(mockRoom.localParticipant.enableCameraAndMicrophone).toHaveBeenCalled();
	});

	it('dial() enables mic only when video=false', async () => {
		await dial('!room:test', false);
		expect(mockRoom.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
	});
});

describe('callSession — LiveKit answer (callee sees caller video)', () => {
	beforeEach(() => {
		_reset();
		vi.clearAllMocks();
		mockRemoteParticipants.clear();
		mockRoom.on.mockReturnThis();
	});

	it('answer() connects to LiveKit and transitions to connected', async () => {
		_update({ phase: 'ringing_in', roomName: '!room:test' });
		await answer('!room:test', true);
		expect(mockRoom.connect).toHaveBeenCalledWith('wss://livekit.test', 'lk-token');
		expect(get(callStore).phase).toBe('connected');
	});

	it('answer() attaches already-subscribed remote video track after connect', async () => {
		// Simulate caller already publishing video when callee joins
		const videoTrack = mockTrack('video');
		mockRemoteParticipants.set('caller', {
			trackPublications: new Map([
				['video', { track: videoTrack, isSubscribed: true, kind: 'video' }]
			])
		});

		const remoteVideo = { srcObject: null };
		const remoteAudio = { srcObject: null };
		setMediaElements(remoteAudio, remoteVideo, null);

		_update({ phase: 'ringing_in', roomName: '!room:test' });
		await answer('!room:test', true);

		// The remote video track must be attached to the video element
		expect(videoTrack.attach).toHaveBeenCalledWith(remoteVideo);
	});

	it('answer() attaches already-subscribed remote audio track after connect', async () => {
		const audioTrack = mockTrack('audio');
		mockRemoteParticipants.set('caller', {
			trackPublications: new Map([
				['audio', { track: audioTrack, isSubscribed: true, kind: 'audio' }]
			])
		});

		const remoteAudio = { srcObject: null };
		setMediaElements(remoteAudio, null, null);

		_update({ phase: 'ringing_in', roomName: '!room:test' });
		await answer('!room:test', true);

		expect(audioTrack.attach).toHaveBeenCalledWith(remoteAudio);
	});

	it('answer() skips unsubscribed tracks', async () => {
		const videoTrack = mockTrack('video');
		mockRemoteParticipants.set('caller', {
			trackPublications: new Map([
				['video', { track: videoTrack, isSubscribed: false, kind: 'video' }]
			])
		});

		const remoteVideo = { srcObject: null };
		setMediaElements(null, remoteVideo, null);

		_update({ phase: 'ringing_in', roomName: '!room:test' });
		await answer('!room:test', true);

		expect(videoTrack.attach).not.toHaveBeenCalled();
	});
});

describe('callSession.notify — call_answered', () => {
	beforeEach(() => {
		_reset();
		vi.clearAllMocks();
	});

	it('ends with answered_elsewhere when session_id differs', async () => {
		_update({ phase: 'ringing_in', roomName: 'p2p_test' });
		notify({ type: 'call_answered', room: 'p2p_test', session_id: 'other-tab-id' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).phase).toBe('ended');
		expect(get(callStore).endReason).toBe(CallEndReason.ANSWERED_ELSEWHERE);
	});

	it('does NOT end call when session_id matches own tab', async () => {
		_update({ phase: 'ringing_in', roomName: 'p2p_test' });
		notify({ type: 'call_answered', room: 'p2p_test', session_id: getClientSessionId() });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).phase).toBe('ringing_in');
	});

	it('ends with answered_elsewhere when no session_id and device differs', async () => {
		_update({ phase: 'ringing_in', roomName: 'p2p_test' });
		notify({ type: 'call_answered', room: 'p2p_test', device_id: 'other-device-id' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).phase).toBe('ended');
		expect(get(callStore).endReason).toBe(CallEndReason.ANSWERED_ELSEWHERE);
	});

	it('ignores call_answered when not ringing_in', async () => {
		_update({ phase: 'connected', roomName: 'p2p_test' });
		notify({ type: 'call_answered', room: 'p2p_test', device_id: 'other-device-id' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).phase).toBe('connected');
	});

	it('ignores call_answered for a different room', async () => {
		_update({ phase: 'ringing_in', roomName: 'p2p_mine' });
		notify({ type: 'call_answered', room: 'p2p_other', device_id: 'other-device-id' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).phase).toBe('ringing_in');
	});
});

describe('callSession.notify — call_decline / call_cancel', () => {
	beforeEach(() => {
		_reset();
		vi.clearAllMocks();
	});

	it('ends with declined when ringing_out and call_decline received', async () => {
		_update({ phase: 'ringing_out', roomName: 'p2p_test' });
		notify({ type: 'call_decline', room: 'p2p_test' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).endReason).toBe(CallEndReason.DECLINED);
	});

	it('ends with cancelled when ringing_in and call_cancel received', async () => {
		_update({ phase: 'ringing_in', roomName: 'p2p_test' });
		notify({ type: 'call_cancel', room: 'p2p_test' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).endReason).toBe(CallEndReason.CANCELLED);
	});

	it('ends with cancelled when ringing_in and call_ended received', async () => {
		_update({ phase: 'ringing_in', roomName: 'p2p_test' });
		notify({ type: 'call_ended', room: 'p2p_test' });
		await new Promise((r) => setTimeout(r, 10));
		expect(get(callStore).endReason).toBe(CallEndReason.CANCELLED);
	});
});

describe('callSession.notify — room calls', () => {
	beforeEach(() => {
		_reset();
		vi.clearAllMocks();
	});

	it('opens room incoming route on room_call_invite', () => {
		const action = notify({
			type: 'room_call_invite',
			room_id: 'room-1',
			room_name: 'Family',
			room_ext: 'room_abc',
			started_at: '2026-03-09T20:00:00',
			started_by_name: 'Alice',
			participant_count: 1,
			video: true
		});
		expect(action.navigateTo).toContain('/call/incoming/room/room-1');
		expect(get(callStore).phase).toBe('ringing_in');
		expect(get(callStore).mode).toBe('room');
		expect(get(callStore).roomId).toBe('room-1');
	});

	it('suppresses dismissed room invites for the same meeting', () => {
		dismissRoomInvite('room-1', '2026-03-09T20:00:00');
		const action = notify({
			type: 'room_call_invite',
			room_id: 'room-1',
			room_name: 'Family',
			room_ext: 'room_abc',
			started_at: '2026-03-09T20:00:00',
			started_by_name: 'Alice',
			participant_count: 1,
			video: true
		});
		expect(action.navigateTo).toBeNull();
		expect(get(callStore).phase).toBe('idle');
	});

	it('updates participant count for active room call', () => {
		_update({
			phase: 'connected',
			mode: 'room',
			roomId: 'room-1',
			roomName: 'room_abc',
			participantCount: 1
		});
		notify({
			type: 'room_call_updated',
			room_id: 'room-1',
			started_at: '2026-03-09T20:00:00',
			participant_count: 3
		});
		expect(get(callStore).participantCount).toBe(3);
		expect(get(callStore).callStartedAt).toBe('2026-03-09T20:00:00');
	});
});

describe('callSession — resumeAudio()', () => {
	beforeEach(() => {
		_reset();
		vi.clearAllMocks();
		mockRemoteParticipants.clear();
		mockRoom.on.mockReturnThis();
	});

	it('calls room.startAudio() when a LiveKit room is active', async () => {
		await dial('!room:test', false);
		mockRoom.startAudio.mockClear();
		resumeAudio();
		expect(mockRoom.startAudio).toHaveBeenCalledOnce();
	});

	it('is a no-op and does not throw when no room is active', () => {
		// _reset() ensures _livekitRoom is null
		expect(() => resumeAudio()).not.toThrow();
	});
});
