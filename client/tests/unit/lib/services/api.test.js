import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get, post, patch, del, onAuthError } from '@client/lib/services/api';
import * as auth from '@client/lib/services/auth';

describe('api service', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.removeItem('token');
		localStorage.removeItem('refresh_token');
	});

	it('makes GET request with auth header', async () => {
		auth.setTokens('tok123', null);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 })
		);
		const result = await get('/test');
		expect(result).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledWith(
			'/api/test',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({ Authorization: 'Bearer tok123' })
			})
		);
	});

	it('makes POST request with body', async () => {
		auth.setTokens('tok', null);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ id: 1 }), { status: 200 })
		);
		const result = await post('/items', { name: 'test' });
		expect(result).toEqual({ id: 1 });
		expect(fetch).toHaveBeenCalledWith(
			'/api/items',
			expect.objectContaining({
				method: 'POST',
				body: '{"name":"test"}'
			})
		);
	});

	it('returns null on 204', async () => {
		auth.setTokens('tok', null);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
		const result = await del('/items/1');
		expect(result).toBeNull();
	});

	it('makes PATCH request with body', async () => {
		auth.setTokens('tok', null);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 })
		);
		const result = await patch('/rooms/r1', { name: 'New name' });
		expect(result).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledWith(
			'/api/rooms/r1',
			expect.objectContaining({
				method: 'PATCH',
				body: '{"name":"New name"}'
			})
		);
	});

	it('throws on error response', async () => {
		auth.setTokens('tok', null);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
		);
		await expect(get('/missing')).rejects.toThrow('Not found');
	});

	it('refreshes token on 401', async () => {
		auth.setTokens('expired', 'refresh_tok');
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'new_tok' }), { status: 200 })
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: 'ok' }), { status: 200 }));

		const result = await get('/protected');
		expect(result).toEqual({ data: 'ok' });
		expect(auth.getToken()).toBe('new_tok');
	});

	it('calls onAuthError when refresh fails', async () => {
		auth.setTokens('expired', 'bad_refresh');
		const handler = vi.fn();
		onAuthError(handler);
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 401 }));

		const result = await get('/protected');
		expect(result).toBeNull();
		expect(handler).toHaveBeenCalled();
		expect(auth.getToken()).toBeNull();
	});
});
