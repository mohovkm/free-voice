import { MatrixMessageType } from '$lib/types/matrix';
import type { PendingAttachment } from '$lib/types/routes';

export function classifyAttachment(file: File): PendingAttachment['messageType'] {
	if (file.type.startsWith('image/')) return MatrixMessageType.IMAGE;
	if (file.type.startsWith('audio/')) return MatrixMessageType.AUDIO;
	if (file.type.startsWith('video/')) return MatrixMessageType.VIDEO;
	return MatrixMessageType.FILE;
}

export function createAttachmentPreviewUrl(
	file: File,
	messageType: PendingAttachment['messageType']
): string | null {
	return messageType === MatrixMessageType.IMAGE || messageType === MatrixMessageType.VIDEO
		? URL.createObjectURL(file)
		: null;
}

export function buildPendingAttachment(file: File): PendingAttachment {
	const messageType = classifyAttachment(file);
	return {
		file,
		messageType,
		previewUrl: createAttachmentPreviewUrl(file, messageType)
	};
}

export function revokePendingAttachment(attachment: PendingAttachment): void {
	if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

export function formatRecorderTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function buildRecordedAudioFile(blob: Blob, now = Date.now()): File {
	const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
	return new File([blob], `voice-${now}.${ext}`, { type: blob.type });
}

export function buildRecordedVideoFile(blob: Blob, now = Date.now()): File {
	const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
	return new File([blob], `video-${now}.${ext}`, { type: blob.type });
}
