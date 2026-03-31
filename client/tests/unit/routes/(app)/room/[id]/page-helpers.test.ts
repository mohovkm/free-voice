import { describe, expect, it } from 'vitest';
import {
	buildGalleryImages,
	buildLightboxState,
	buildTypingLabel,
	createTextLocalEcho,
	formatMessageTime,
	isMessageReadByPeer,
	toActiveCallState
} from '@client/routes/(app)/room/[id]/page-helpers';

describe('room page helpers', () => {
	it('builds gallery images from image messages only', () => {
		expect(
			buildGalleryImages([
				{
					id: '1',
					roomId: '!room',
					senderId: '@a',
					senderName: 'A',
					type: 'image',
					body: 'photo',
					media: {
						mxcUrl: 'mxc://a',
						mimeType: 'image/png',
						size: 1,
						filename: 'a.png',
						thumbnailUrl: null,
						durationSecs: null,
						waveformData: null
					},
					ts: 1,
					isoTs: new Date(1).toISOString(),
					mine: false,
					txnId: null,
					replyTo: null,
					callMeta: null
				},
				{
					id: '2',
					roomId: '!room',
					senderId: '@a',
					senderName: 'A',
					type: 'text',
					body: 'ignore',
					media: null,
					ts: 1,
					isoTs: new Date(1).toISOString(),
					mine: false,
					txnId: null,
					replyTo: null,
					callMeta: null
				}
			])
		).toEqual([{ mxcUrl: 'mxc://a', alt: 'photo' }]);
	});

	it('builds typing labels for group rooms', () => {
		expect(buildTypingLabel({}, true)).toBe('');
		expect(buildTypingLabel({ a: 'Alice' }, true)).toBe('Alice is typing...');
		expect(buildTypingLabel({ a: 'Alice', b: 'Bob' }, true)).toBe('Alice, Bob are typing...');
	});

	it('creates lightbox state with stable index', () => {
		expect(
			buildLightboxState('mxc://b', 'B', [
				{ mxcUrl: 'mxc://a', alt: 'A' },
				{ mxcUrl: 'mxc://b', alt: 'B' }
			])
		).toEqual({
			mxcUrl: 'mxc://b',
			alt: 'B',
			index: 1
		});
	});

	it('creates text local echoes with reply previews', () => {
		expect(
			createTextLocalEcho({
				txnId: 'tx1',
				roomId: '!room',
				senderId: '@me',
				body: 'hello',
				senderName: 'Me',
				replyTarget: { id: 'orig', body: 'quoted', senderName: 'Alice' },
				now: 10
			})
		).toMatchObject({
			id: 'echo:tx1',
			txnId: 'tx1',
			body: 'hello',
			replyTo: { eventId: 'orig', body: 'quoted', senderName: 'Alice' }
		});
	});

	it('maps active call events into banner state', () => {
		expect(
			toActiveCallState({
				type: 'room_call_updated',
				room_ext: 'room-a',
				participant_count: 2,
				started_by_name: 'Alice'
			})
		).toEqual({
			room_name: 'room-a',
			participant_count: 2,
			started_at: undefined,
			started_by_name: 'Alice'
		});
	});

	it('formats timestamps into non-empty display strings', () => {
		expect(formatMessageTime('2026-01-01T10:00:00.000Z')).not.toBe('');
	});

	it('treats an exact peer read event-id match as read even when timestamps differ', () => {
		expect(
			isMessageReadByPeer(
				{
					id: '$event-1',
					roomId: '!room',
					senderId: '@me',
					senderName: 'Me',
					type: 'text',
					body: 'hello',
					media: null,
					ts: 200,
					isoTs: new Date(200).toISOString(),
					mine: true,
					txnId: null,
					replyTo: null,
					callMeta: null
				},
				100,
				'$event-1'
			)
		).toBe(true);
	});

	it('keeps sent messages unread when neither the timestamp nor event id has advanced', () => {
		expect(
			isMessageReadByPeer(
				{
					id: '$event-2',
					roomId: '!room',
					senderId: '@me',
					senderName: 'Me',
					type: 'text',
					body: 'hello',
					media: null,
					ts: 200,
					isoTs: new Date(200).toISOString(),
					mine: true,
					txnId: null,
					replyTo: null,
					callMeta: null
				},
				100,
				'$other-event'
			)
		).toBe(false);
	});
});
