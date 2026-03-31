import { describe, expect, it } from 'vitest';
import { parseJwtPayload } from '@client/lib/services/normalizers/auth';

function buildJwt(payload) {
	return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('auth normalizers', () => {
	it('parses supported jwt fields from a token payload', () => {
		expect(parseJwtPayload(buildJwt({ sub: '@alice:example.com', exp: 1234 }))).toMatchObject({
			sub: '@alice:example.com',
			exp: 1234
		});
	});

	it('drops invalid typed fields instead of leaking unknown shapes', () => {
		expect(parseJwtPayload(buildJwt({ sub: 7, exp: 'soon', role: 'admin' }))).toEqual({
			role: 'admin'
		});
	});

	it('throws on malformed tokens', () => {
		expect(() => parseJwtPayload('not-a-jwt')).toThrow('Invalid JWT');
	});
});
