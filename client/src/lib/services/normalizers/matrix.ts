import {
	MatrixMessageType,
	type MatrixMediaPayload,
	type MatrixReplyPreview
} from '$lib/types/matrix';

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isFiniteNumberSample(sample: unknown): sample is number {
	return typeof sample === 'number' && Number.isFinite(sample);
}

export function getMatrixCallId(content: unknown): string | null {
	return asString(asRecord(content)?.call_id);
}

export function normalizeMatrixMediaPayload(
	content: unknown,
	msgtype: string | null
): MatrixMediaPayload | null {
	if (
		msgtype !== MatrixMessageType.IMAGE &&
		msgtype !== MatrixMessageType.AUDIO &&
		msgtype !== MatrixMessageType.VIDEO &&
		msgtype !== MatrixMessageType.FILE
	) {
		return null;
	}

	const record = asRecord(content);
	const info = asRecord(record?.info);
	const durationMs = asFiniteNumber(info?.duration);
	const waveform = Array.isArray(info?.waveform)
		? info.waveform.filter(isFiniteNumberSample)
		: null;

	return {
		mxcUrl: asString(record?.url),
		mimeType: asString(info?.mimetype),
		size: asFiniteNumber(info?.size),
		filename: asString(record?.filename) || asString(record?.body),
		thumbnailUrl: asString(info?.thumbnail_url),
		durationSecs:
			msgtype === MatrixMessageType.AUDIO && durationMs !== null ? Math.round(durationMs / 1000) : null,
		waveformData: msgtype === MatrixMessageType.AUDIO ? waveform : null
	};
}

export function normalizeReplyPreview(
	content: unknown,
	room: { findEventById?: (eventId: string) => unknown } | null | undefined
): MatrixReplyPreview | null {
	const record = asRecord(content);
	const relates = asRecord(record?.['m.relates_to']);
	const inReplyTo = asRecord(relates?.['m.in_reply_to']);
	const eventId = asString(inReplyTo?.event_id);

	if (!eventId) {
		return null;
	}

	const original = room?.findEventById?.(eventId) as
		| {
				getContent?: () => unknown;
				getSender?: () => string | null | undefined;
				sender?: { name?: string | null };
		  }
		| undefined;
	if (!original) {
		return {
			eventId,
			body: '…',
			senderName: ''
		};
	}

	const originalContent = asRecord(original.getContent?.());
	const originalSender = original.sender;

	return {
		eventId,
		body: asString(originalContent?.body) || '',
		senderName: asString(originalSender?.name) || asString(original.getSender?.()) || ''
	};
}
