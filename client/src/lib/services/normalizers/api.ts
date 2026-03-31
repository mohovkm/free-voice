import type { ApiErrorPayload } from '$lib/types/api';
import type { AuthTokens } from '$lib/types/auth';

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function normalizeApiErrorPayload(value: unknown, fallbackDetail: string): ApiErrorPayload {
	const record = asRecord(value);
	if (record && typeof record.detail === 'string' && record.detail.trim()) {
		return { detail: record.detail };
	}
	return { detail: fallbackDetail };
}

export function normalizeRefreshTokenResponse(value: unknown): AuthTokens {
	const record = asRecord(value);
	if (!record || typeof record.access_token !== 'string' || !record.access_token) {
		throw new Error('Invalid refresh response payload');
	}
	return {
		accessToken: record.access_token,
		refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : null
	};
}
