import type { JwtPayload } from '$lib/types/auth';

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function parseJwtPayload(token: string): JwtPayload {
	const parts = token.split('.');
	if (parts.length < 2 || !parts[1]) {
		throw new Error('Invalid JWT');
	}
	const decoded = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
	const record = asRecord(decoded);
	if (!record) {
		throw new Error('Invalid JWT payload');
	}
	const payload: JwtPayload = { ...record };
	if ('sub' in payload && payload.sub !== undefined && typeof payload.sub !== 'string') {
		delete payload.sub;
	}
	if ('exp' in payload && payload.exp !== undefined && typeof payload.exp !== 'number') {
		delete payload.exp;
	}
	return payload;
}
