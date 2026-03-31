import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	normalizeEvent,
	addLocalEcho,
	removeLocalEcho,
	messagesFor,
	lastMessageFor,
	resetStore,
	initStore,
	_notify
} from '@client/lib/stores/matrixStore';

// --- Helpers ---

function makeEvent({
	id,
	roomId = '!r:example.com',
	sender = '@alice:example.com',
	body = 'hello',
	ts = 1000,
	txnId = null
} = {}) {
	return {
		getId: () => id,
		getRoomId: () => roomId,
		getSender: () => sender,
		getType: () => 'm.room.message',
		getContent: () => ({ msgtype: 'm.text', body, 'm.relates_to': undefined }),
		getTs: () => ts,
		getUnsignedData: () => (txnId ? { transaction_id: txnId } : {}),
		sender: { name: sender }
	};
}

const ROOM = '!room:example.com';
const ME = '@alice:example.com';

beforeEach(() => {
	resetStore();
});

// --- normalizeEvent ---

describe('normalizeEvent()', () => {
	it('maps SDK event to NormalizedEvent shape', () => {
		const ev = makeEvent({ id: '$e1', body: 'hi', ts: 5000 });
		const result = normalizeEvent(ev, ME, null);

		expect(result).toMatchObject({
			id: '$e1',
			roomId: '!r:example.com',
			senderId: '@alice:example.com',
			senderName: '@alice:example.com',
			body: 'hi',
			ts: 5000,
			isoTs: new Date(5000).toISOString(),
			mine: true,
			txnId: null,
			replyTo: null
		});
	});

	it('sets mine:false for other senders', () => {
		const ev = makeEvent({ id: '$e2', sender: '@bob:example.com' });
		const result = normalizeEvent(ev, ME, null);
		expect(result.mine).toBe(false);
	});

	it('extracts txnId from unsigned data', () => {
		const ev = makeEvent({ id: '$e3', txnId: 'txn_abc' });
		const result = normalizeEvent(ev, ME, null);
		expect(result.txnId).toBe('txn_abc');
	});

	it('builds replyTo from room.findEventById when reply-to is present', () => {
		const originalEv = makeEvent({ id: '$orig', body: 'original', sender: '@bob:example.com' });
		const ev = {
			...makeEvent({ id: '$reply' }),
			getContent: () => ({
				body: 'reply text',
				'm.relates_to': { 'm.in_reply_to': { event_id: '$orig' } }
			})
		};
		const room = { findEventById: (id) => (id === '$orig' ? originalEv : null) };

		const result = normalizeEvent(ev, ME, room);
		expect(result.replyTo).toEqual({
			eventId: '$orig',
			body: 'original',
			senderName: '@bob:example.com'
		});
	});

	it('sets type:text for m.text messages', () => {
		const ev = {
			...makeEvent({ id: '$t1' }),
			getType: () => 'm.room.message',
			getContent: () => ({ msgtype: 'm.text', body: 'hello', 'm.relates_to': undefined })
		};
		expect(normalizeEvent(ev, ME, null).type).toBe('text');
	});

	it('sets type:image and media for m.image', () => {
		const ev = {
			...makeEvent({ id: '$img1' }),
			getType: () => 'm.room.message',
			getContent: () => ({
				msgtype: 'm.image',
				body: 'photo.jpg',
				url: 'mxc://example.com/abc',
				info: { mimetype: 'image/jpeg', size: 12345 },
				'm.relates_to': undefined
			})
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.type).toBe('image');
		expect(result.media).toMatchObject({
			mxcUrl: 'mxc://example.com/abc',
			mimeType: 'image/jpeg',
			size: 12345,
			filename: 'photo.jpg'
		});
	});

	it('sets type:audio and media for m.audio', () => {
		const ev = {
			...makeEvent({ id: '$aud1' }),
			getType: () => 'm.room.message',
			getContent: () => ({
				msgtype: 'm.audio',
				body: 'voice.ogg',
				url: 'mxc://example.com/aud',
				info: { mimetype: 'audio/ogg', size: 5000 },
				'm.relates_to': undefined
			})
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.type).toBe('audio');
		expect(result.media?.mxcUrl).toBe('mxc://example.com/aud');
	});

	it('reads info.duration and info.waveform from m.audio into media.durationSecs / media.waveformData', () => {
		const waveform = Array(60).fill(0.5);
		const ev = {
			...makeEvent({ id: '$aud2' }),
			getType: () => 'm.room.message',
			getContent: () => ({
				msgtype: 'm.audio',
				body: 'voice.webm',
				url: 'mxc://example.com/aud2',
				info: { mimetype: 'audio/webm', size: 12000, duration: 30500, waveform },
				'm.relates_to': undefined
			})
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.media.durationSecs).toBe(31); // Math.round(30500 / 1000)
		expect(result.media.waveformData).toEqual(waveform);
	});

	it('leaves media.durationSecs and media.waveformData null for m.audio without info fields', () => {
		const ev = {
			...makeEvent({ id: '$aud3' }),
			getType: () => 'm.room.message',
			getContent: () => ({
				msgtype: 'm.audio',
				body: 'attach.ogg',
				url: 'mxc://example.com/aud3',
				info: { mimetype: 'audio/ogg', size: 8000 },
				'm.relates_to': undefined
			})
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.media.durationSecs).toBeNull();
		expect(result.media.waveformData).toBeNull();
	});

	it('sets type:video and media for m.video', () => {
		const ev = {
			...makeEvent({ id: '$vid1' }),
			getType: () => 'm.room.message',
			getContent: () => ({
				msgtype: 'm.video',
				body: 'clip.mp4',
				url: 'mxc://example.com/vid',
				info: { mimetype: 'video/mp4', size: 200000, thumbnail_url: 'mxc://example.com/thumb' },
				'm.relates_to': undefined
			})
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.type).toBe('video');
		expect(result.media?.thumbnailUrl).toBe('mxc://example.com/thumb');
	});

	it('sets type:file and media for m.file', () => {
		const ev = {
			...makeEvent({ id: '$file1' }),
			getType: () => 'm.room.message',
			getContent: () => ({
				msgtype: 'm.file',
				body: 'doc.pdf',
				url: 'mxc://example.com/file',
				info: { mimetype: 'application/pdf', size: 30000 },
				'm.relates_to': undefined
			})
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.type).toBe('file');
		expect(result.media?.filename).toBe('doc.pdf');
	});

	it('sets type:system and descriptive body for m.room.member join', () => {
		const ev = {
			getId: () => '$state1',
			getRoomId: () => '!r:example.com',
			getSender: () => '@bob:example.com',
			getType: () => 'm.room.member',
			getContent: () => ({ membership: 'join', displayname: 'Bob' }),
			getTs: () => 1000,
			getUnsignedData: () => ({}),
			sender: { name: 'Bob' }
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.type).toBe('system');
		expect(result.body).toBe('Bob joined');
		expect(result.media).toBeNull();
	});

	it('sets type:system for m.call.invite', () => {
		const ev = {
			getId: () => '$call1',
			getRoomId: () => '!r:example.com',
			getSender: () => '@bob:example.com',
			getType: () => 'm.call.invite',
			getContent: () => ({}),
			getTs: () => 1000,
			getUnsignedData: () => ({}),
			sender: { name: 'Bob' }
		};
		const result = normalizeEvent(ev, ME, null);
		expect(result.type).toBe('system');
		expect(result.body).toBe('Call started');
	});
});

// --- ingestEvent ---

// --- SDK-backed store tests ---
// The store reads directly from the SDK client. We mock the client.

function makeSdkEvent({
	id,
	roomId = '!r:example.com',
	sender = '@alice:example.com',
	body = 'hi',
	ts = 1000,
	msgtype = 'm.text',
	status = null,
	txnId = null
} = {}) {
	return {
		getId: () => id,
		getRoomId: () => roomId,
		getSender: () => sender,
		getType: () => 'm.room.message',
		getContent: () => ({ msgtype, body, 'm.relates_to': undefined }),
		getTs: () => ts,
		getUnsignedData: () => (txnId ? { transaction_id: txnId } : {}),
		sender: { name: sender },
		status
	};
}

function makeMockClient(events = []) {
	const room = {
		getLiveTimeline: () => ({ getEvents: () => events }),
		findEventById: () => null
	};
	return {
		getRoom: (id) => room,
		getUserId: () => '@alice:example.com',
		getUser: () => null
	};
}

describe('messagesFor() — SDK-backed', () => {
	it('reads events from SDK timeline', () => {
		const ev = makeSdkEvent({ id: '$e1', body: 'hello' });
		const client = makeMockClient([ev]);
		initStore(client);
		_notify();
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(1);
		expect(msgs[0].id).toBe('$e1');
		expect(msgs[0].body).toBe('hello');
	});

	it('appends local echoes after SDK events', () => {
		const ev = makeSdkEvent({ id: '$e1', body: 'confirmed' });
		const client = makeMockClient([ev]);
		initStore(client);
		addLocalEcho('!r:example.com', {
			id: 'echo:txn_x',
			txnId: 'txn_x',
			roomId: '!r:example.com',
			body: 'pending',
			type: 'text',
			media: null,
			mine: true,
			ts: 2000,
			isoTs: '',
			senderName: '',
			replyTo: null
		});
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(2);
		expect(msgs[0].id).toBe('$e1');
		expect(msgs[1].id).toBe('echo:txn_x');
		expect(msgs[1]._isLocalEcho).toBe(true);
	});

	it('drops echo when confirmed txnId appears in SDK timeline', () => {
		const confirmed = makeSdkEvent({ id: '$confirmed', body: 'sent', txnId: 'txn_x' });
		const client = makeMockClient([confirmed]);
		initStore(client);
		addLocalEcho('!r:example.com', {
			id: 'echo:txn_x',
			txnId: 'txn_x',
			roomId: '!r:example.com',
			body: 'pending',
			type: 'text',
			media: null,
			mine: true,
			ts: 1000,
			isoTs: '',
			senderName: '',
			replyTo: null
		});
		// Simulate server confirmation — remove echo
		removeLocalEcho('!r:example.com', 'txn_x');
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(1);
		expect(msgs[0].id).toBe('$confirmed');
	});

	it('skips SDK events with truthy status (pending SDK echoes)', () => {
		const pending = makeSdkEvent({ id: '$p1', status: 'sending' });
		const client = makeMockClient([pending]);
		initStore(client);
		_notify();
		expect(get(messagesFor('!r:example.com'))).toHaveLength(0);
	});

	it('returns empty array when no client', () => {
		resetStore();
		expect(get(messagesFor('!r:example.com'))).toHaveLength(0);
	});
});

describe('addLocalEcho() / removeLocalEcho()', () => {
	it('adds echo visible in messagesFor', () => {
		initStore(makeMockClient([]));
		addLocalEcho('!r:example.com', {
			id: 'echo:t1',
			txnId: 't1',
			roomId: '!r:example.com',
			body: 'hi',
			type: 'text',
			media: null,
			mine: true,
			ts: 1,
			isoTs: '',
			senderName: '',
			replyTo: null
		});
		expect(get(messagesFor('!r:example.com'))).toHaveLength(1);
	});

	it('removeLocalEcho removes it from messagesFor', () => {
		initStore(makeMockClient([]));
		addLocalEcho('!r:example.com', {
			id: 'echo:t2',
			txnId: 't2',
			roomId: '!r:example.com',
			body: 'hi',
			type: 'text',
			media: null,
			mine: true,
			ts: 1,
			isoTs: '',
			senderName: '',
			replyTo: null
		});
		removeLocalEcho('!r:example.com', 't2');
		expect(get(messagesFor('!r:example.com'))).toHaveLength(0);
	});
});

describe('lastMessageFor() — SDK-backed', () => {
	it('returns { text, msgtype } for last text message', () => {
		const events = [
			makeSdkEvent({ id: '$e1', body: 'first', ts: 1000, msgtype: 'm.text' }),
			makeSdkEvent({ id: '$e2', body: 'second', ts: 2000, msgtype: 'm.text' })
		];
		initStore(makeMockClient(events));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: 'second', msgtype: 'm.text' });
	});

	it('returns { text: filename, msgtype: m.image } for image message', () => {
		const events = [makeSdkEvent({ id: '$e1', body: 'photo.jpg', ts: 1000, msgtype: 'm.image' })];
		initStore(makeMockClient(events));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({
			text: 'photo.jpg',
			msgtype: 'm.image'
		});
	});

	it('returns { text: filename, msgtype: m.audio } for audio message', () => {
		const events = [makeSdkEvent({ id: '$e1', body: 'voice.ogg', ts: 1000, msgtype: 'm.audio' })];
		initStore(makeMockClient(events));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({
			text: 'voice.ogg',
			msgtype: 'm.audio'
		});
	});

	it('returns { text: filename, msgtype: m.video } for video message', () => {
		const events = [makeSdkEvent({ id: '$e1', body: 'clip.mp4', ts: 1000, msgtype: 'm.video' })];
		initStore(makeMockClient(events));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: 'clip.mp4', msgtype: 'm.video' });
	});

	it('returns { text: filename, msgtype: m.file } for file message', () => {
		const events = [makeSdkEvent({ id: '$e1', body: 'doc.pdf', ts: 1000, msgtype: 'm.file' })];
		initStore(makeMockClient(events));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: 'doc.pdf', msgtype: 'm.file' });
	});

	it('returns { text: empty, msgtype: call } when only a call hangup event exists', () => {
		const callEv = makeCallEvent({ id: '$hup1', type: 'm.call.hangup', ts: 5000 });
		initStore(makeMockClient([callEv]));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: '', msgtype: 'call' });
	});

	it('prefers the latest call event over an older message in the chat list preview', () => {
		const text = makeSdkEvent({ id: '$e1', body: 'voice.ogg', ts: 1000, msgtype: 'm.audio' });
		const hangup = makeCallEvent({ id: '$hup-latest', type: 'm.call.hangup', ts: 5000 });
		initStore(makeMockClient([text, hangup]));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: '', msgtype: 'call' });
	});

	it('returns { text: empty, msgtype: empty } for empty room', () => {
		initStore(makeMockClient([]));
		_notify();
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: '', msgtype: '' });
	});
});

// Helper: make a call event (invite or hangup)
function makeCallEvent({
	id,
	type,
	sender = '@alice:example.com',
	callId = 'call_1',
	ts = 1000
} = {}) {
	return {
		getId: () => id,
		getRoomId: () => '!r:example.com',
		getSender: () => sender,
		getType: () => type,
		getContent: () => ({ call_id: callId }),
		getTs: () => ts,
		getUnsignedData: () => ({}),
		sender: { name: sender },
		status: null
	};
}

describe('call log normalization (readTimeline)', () => {
	it('paired invite+hangup >= 30s apart emits one type:call entry with status:answered', () => {
		const invite = makeCallEvent({
			id: '$inv1',
			type: 'm.call.invite',
			sender: '@alice:example.com',
			ts: 1000
		});
		const hangup = makeCallEvent({
			id: '$hup1',
			type: 'm.call.hangup',
			sender: '@alice:example.com',
			ts: 32000
		});
		const client = makeMockClient([invite, hangup]);
		initStore(client);
		_notify();
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(1);
		expect(msgs[0].type).toBe('call');
		expect(msgs[0].callMeta.status).toBe('answered');
		expect(msgs[0].callMeta.direction).toBe('outgoing');
		expect(msgs[0].callMeta.durationSecs).toBe(31);
	});

	it('paired invite+hangup emits status:answered even for short calls', () => {
		const invite = makeCallEvent({
			id: '$inv2',
			type: 'm.call.invite',
			sender: '@alice:example.com',
			ts: 1000
		});
		const hangup = makeCallEvent({
			id: '$hup2',
			type: 'm.call.hangup',
			sender: '@alice:example.com',
			ts: 10000
		});
		const client = makeMockClient([invite, hangup]);
		initStore(client);
		_notify();
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(1);
		expect(msgs[0].type).toBe('call');
		expect(msgs[0].callMeta.status).toBe('answered');
		expect(msgs[0].callMeta.durationSecs).toBe(9);
	});

	it('lone invite (no hangup) emits type:call with status:ringing', () => {
		const invite = makeCallEvent({
			id: '$inv3',
			type: 'm.call.invite',
			sender: '@alice:example.com',
			ts: 1000
		});
		const client = makeMockClient([invite]);
		initStore(client);
		_notify();
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(1);
		expect(msgs[0].type).toBe('call');
		expect(msgs[0].callMeta.status).toBe('ringing');
	});

	it('invite+hangup pair emits only ONE entry (invite suppressed)', () => {
		const invite = makeCallEvent({ id: '$inv4', type: 'm.call.invite', ts: 1000 });
		const hangup = makeCallEvent({ id: '$hup4', type: 'm.call.hangup', ts: 5000 });
		const client = makeMockClient([invite, hangup]);
		initStore(client);
		_notify();
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs).toHaveLength(1);
		expect(msgs[0].id).toBe('$hup4');
	});

	it('incoming call (remote sender on invite) sets callMeta.direction:incoming', () => {
		const invite = makeCallEvent({
			id: '$inv5',
			type: 'm.call.invite',
			sender: '@bob:example.com',
			ts: 1000
		});
		const hangup = makeCallEvent({
			id: '$hup5',
			type: 'm.call.hangup',
			sender: '@bob:example.com',
			ts: 5000
		});
		const client = makeMockClient([invite, hangup]);
		initStore(client);
		_notify();
		const msgs = get(messagesFor('!r:example.com'));
		expect(msgs[0].callMeta.direction).toBe('incoming');
	});
});

describe('resetStore()', () => {
	it('clears echoes and client reference', () => {
		initStore(makeMockClient([makeSdkEvent({ id: '$e1' })]));
		addLocalEcho('!r:example.com', {
			id: 'echo:t1',
			txnId: 't1',
			roomId: '!r:example.com',
			body: 'hi',
			type: 'text',
			media: null,
			mine: true,
			ts: 1,
			isoTs: '',
			senderName: '',
			replyTo: null
		});
		resetStore();
		expect(get(messagesFor('!r:example.com'))).toHaveLength(0);
		expect(get(lastMessageFor('!r:example.com'))).toEqual({ text: '', msgtype: '' });
	});
});
