import { describe, expect, it } from 'vitest';
import { getMatrixCallId, normalizeMatrixMediaPayload, normalizeReplyPreview } from '@client/lib/services/normalizers/matrix';

describe('matrix normalizers', () => {
	it('normalizes audio media payloads from Matrix content', () => {
		expect(
			normalizeMatrixMediaPayload(
				{
					url: 'mxc://server/audio',
					body: 'voice-note.ogg',
					info: {
						mimetype: 'audio/ogg',
						size: 42,
						duration: 2300,
						waveform: [1, 2, 'skip', 3]
					}
				},
				'm.audio'
			)
		).toEqual({
			mxcUrl: 'mxc://server/audio',
			mimeType: 'audio/ogg',
			size: 42,
			filename: 'voice-note.ogg',
			thumbnailUrl: null,
			durationSecs: 2,
			waveformData: [1, 2, 3]
		});
	});

	it('extracts reply previews from sdk room events', () => {
		const room = {
			findEventById(eventId) {
				if (eventId !== '$reply') return null;
				return {
					getContent: () => ({ body: 'hello there' }),
					getSender: () => '@alice:example.com',
					sender: { name: 'Alice' }
				};
			}
		};

		expect(
			normalizeReplyPreview(
				{
					'm.relates_to': {
						'm.in_reply_to': { event_id: '$reply' }
					}
				},
				room
			)
		).toEqual({
			eventId: '$reply',
			body: 'hello there',
			senderName: 'Alice'
		});
	});

	it('returns nullable values for missing sdk identifiers', () => {
		expect(getMatrixCallId({ call_id: 'call-1' })).toBe('call-1');
		expect(getMatrixCallId({ call_id: 1 })).toBeNull();
	});
});
