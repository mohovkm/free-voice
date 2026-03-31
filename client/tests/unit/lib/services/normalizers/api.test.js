import { describe, expect, it } from 'vitest';
import { normalizeApiErrorPayload, normalizeRefreshTokenResponse } from '@client/lib/services/normalizers/api';

describe('api normalizers', () => {
	it('normalizes refresh token responses into app-owned auth tokens', () => {
		expect(
			normalizeRefreshTokenResponse({
				access_token: 'access-token',
				refresh_token: 'refresh-token'
			})
		).toEqual({
			accessToken: 'access-token',
			refreshToken: 'refresh-token'
		});
	});

	it('falls back to null refresh token when the API omits it', () => {
		expect(
			normalizeRefreshTokenResponse({
				access_token: 'access-token'
			})
		).toEqual({
			accessToken: 'access-token',
			refreshToken: null
		});
	});

	it('normalizes error payloads with a fallback detail', () => {
		expect(normalizeApiErrorPayload({ detail: 'invalid session' }, 'unknown')).toEqual({
			detail: 'invalid session'
		});
		expect(normalizeApiErrorPayload({ message: 'ignored' }, 'unknown')).toEqual({
			detail: 'unknown'
		});
	});
});
