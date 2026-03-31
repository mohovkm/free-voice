import { describe, expect, it, vi } from 'vitest';
import {
	buildPendingAttachment,
	buildRecordedAudioFile,
	buildRecordedVideoFile,
	classifyAttachment,
	formatRecorderTime,
	revokePendingAttachment
} from '@client/lib/components/chat-input-helpers';

describe('chat input helpers', () => {
	it('classifies attachments by media type', () => {
		expect(classifyAttachment(new File(['x'], 'a.png', { type: 'image/png' }))).toBe('m.image');
		expect(classifyAttachment(new File(['x'], 'a.ogg', { type: 'audio/ogg' }))).toBe('m.audio');
		expect(classifyAttachment(new File(['x'], 'a.webm', { type: 'video/webm' }))).toBe('m.video');
		expect(classifyAttachment(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(
			'm.file'
		);
	});

	it('builds pending attachments with preview urls for images and video', () => {
		const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
		expect(buildPendingAttachment(new File(['x'], 'a.png', { type: 'image/png' }))).toEqual({
			file: expect.any(File),
			messageType: 'm.image',
			previewUrl: 'blob:preview'
		});
		createUrl.mockRestore();
	});

	it('formats recorder time as m:ss', () => {
		expect(formatRecorderTime(0)).toBe('0:00');
		expect(formatRecorderTime(65)).toBe('1:05');
	});

	it('builds recorded media files with stable extensions', () => {
		expect(buildRecordedAudioFile(new Blob(['x'], { type: 'audio/mp4' }), 10).name).toBe(
			'voice-10.m4a'
		);
		expect(buildRecordedVideoFile(new Blob(['x'], { type: 'video/webm' }), 10).name).toBe(
			'video-10.webm'
		);
	});

	it('revokes preview urls when present', () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		revokePendingAttachment({
			file: new File(['x'], 'a.png', { type: 'image/png' }),
			messageType: 'm.image',
			previewUrl: 'blob:preview'
		});
		expect(revoke).toHaveBeenCalledWith('blob:preview');
		revoke.mockRestore();
	});
});
