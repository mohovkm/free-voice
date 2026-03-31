import { test, expect } from 'vitest';

test('Matrix flags are permanently enabled', async () => {
	const { FLAGS } = await import('@client/lib/config');
	expect(FLAGS.USE_MATRIX).toBe(true);
	expect(FLAGS.MATRIX_CALLS).toBe(true);
	expect(FLAGS.LIVEKIT_GROUP_CALLS).toBe(true);
});
