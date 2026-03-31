import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { callStore, isInCall, showEndScreen, _update, _reset } from '@client/lib/stores/call';

beforeEach(() => _reset());

describe('callStore', () => {
	it('starts idle', () => {
		expect(get(callStore).phase).toBe('idle');
		expect(get(callStore).endReason).toBeNull();
	});

	it('_update patches state', () => {
		_update({ phase: 'connected', remoteName: 'Alice' });
		const s = get(callStore);
		expect(s.phase).toBe('connected');
		expect(s.remoteName).toBe('Alice');
	});

	it('_reset returns to initial', () => {
		_update({ phase: 'connected', micMuted: true });
		_reset();
		const s = get(callStore);
		expect(s.phase).toBe('idle');
		expect(s.micMuted).toBe(false);
	});
});

describe('isInCall', () => {
	it('false when idle', () => expect(get(isInCall)).toBe(false));
	it('true when connected', () => {
		_update({ phase: 'connected' });
		expect(get(isInCall)).toBe(true);
	});
	it('true when ringing_out', () => {
		_update({ phase: 'ringing_out' });
		expect(get(isInCall)).toBe(true);
	});
	it('false when ended', () => {
		_update({ phase: 'ended' });
		expect(get(isInCall)).toBe(false);
	});
});

describe('showEndScreen', () => {
	it('false when idle', () => expect(get(showEndScreen)).toBe(false));
	it('true when ended', () => {
		_update({ phase: 'ended' });
		expect(get(showEndScreen)).toBe(true);
	});
	it('false when connected', () => {
		_update({ phase: 'connected' });
		expect(get(showEndScreen)).toBe(false);
	});
});
