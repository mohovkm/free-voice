import { test, expect } from '@playwright/test';
import { installRoomScenario } from './helpers';

const ROOM_ID = '!dm-media:example.test';

function pngBuffer() {
	return Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn/0WQAAAAASUVORK5CYII=',
		'base64'
	);
}

function createFilePayload(name, type, size) {
	return {
		name,
		mimeType: type,
		buffer: Buffer.alloc(size, 1)
	};
}

async function attachFile(page, file) {
	await page.getByRole('button', { name: 'Attach file' }).click();
	await page.locator('input[type="file"]').setInputFiles(file);
}

async function setupMediaRoom(page, roomMessages = []) {
	await installRoomScenario(page, { roomId: ROOM_ID, roomName: 'Alice', roomMessages });
	await page.route('**/logo.png', async (route) => {
		return route.fulfill({ status: 200, contentType: 'image/png', body: pngBuffer() });
	});
	await page.route('https://matrix.example.test/**', async (route) => {
		const url = route.request().url();
		if (url.includes('/_matrix/media/v3/download/example.test/image-ok')) {
			return route.fulfill({ status: 200, contentType: 'image/png', body: pngBuffer() });
		}
		if (url.includes('/_matrix/media/v3/download/example.test/video-ok')) {
			return route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(64, 7) });
		}
		if (
			url.includes('/_matrix/media/v3/download/example.test/image-expired') ||
			url.includes('/_matrix/media/v3/download/example.test/audio-expired')
		) {
			return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
		}
		return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});
}

async function openRoom(page) {
	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await page.locator(`a[href="/room/${encodeURIComponent(ROOM_ID)}"]`).first().click();
	await expect(page).toHaveURL(new RegExp(`/room/${encodeURIComponent(ROOM_ID)}$`));
}

test.describe('Room media flows', () => {
	test('sends image attachments as local echo thumbnails', async ({ page }) => {
		await setupMediaRoom(page);
		await openRoom(page);

		await attachFile(page, {
			name: 'photo.png',
			mimeType: 'image/png',
			buffer: pngBuffer()
		});
		await expect(page.locator('.attachment-chip')).toContainText('photo.png');
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.locator('button[aria-label="Open image"]')).toBeVisible();
		await expect(page.locator('.attachment-chip')).toHaveCount(0);
		const sentMedia = await page.evaluate(() => window.__fvE2E.getSentMedia());
		expect(sentMedia).toHaveLength(1);
		expect(sentMedia[0].messageType).toBe('m.image');
	});

	test('sends audio attachments and renders the inline player with duration metadata', async ({ page }) => {
		await setupMediaRoom(page, [
			{
				id: 'audio-remote',
				body: 'voice.m4a',
				type: 'audio',
				mine: false,
				senderId: '@alice:example.test',
				senderName: 'Alice',
				media: {
					mxcUrl: 'blob:remote-audio',
					mimeType: 'audio/mp4',
					size: 1024,
					filename: 'voice.m4a',
					thumbnailUrl: null,
					durationSecs: 14,
					waveformData: [128, 256, 512]
				}
			}
		]);
		await openRoom(page);

		await expect(page.locator('button[aria-label="Play"]').first()).toBeVisible();
		await expect(page.locator('.audio-player .time').first()).toContainText('0:14');

		await attachFile(page, {
			name: 'note.m4a',
			mimeType: 'audio/mp4',
			buffer: Buffer.alloc(256, 2)
		});
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.locator('.audio-player')).toHaveCount(2);
	});

	test('sends video attachments and opens the video modal', async ({ page }) => {
		await setupMediaRoom(page);
		await openRoom(page);

		await attachFile(page, {
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			buffer: Buffer.alloc(256, 3)
		});
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.locator('button[aria-label="Open video"]')).toBeVisible();
		await page.locator('button[aria-label="Open video"]').click();
		await expect(page.locator('[aria-label="Video player"]')).toBeVisible();
	});

	test('sends file attachments and renders filename plus size', async ({ page }) => {
		await setupMediaRoom(page);
		await openRoom(page);

		await attachFile(page, {
			name: 'notes.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('hello file')
		});
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.locator('.file-attachment')).toContainText('notes.txt');
		await expect(page.locator('.file-attachment')).toContainText('10 B');
	});

	test('rejects oversize uploads before any send occurs', async ({ page }) => {
		await setupMediaRoom(page);
		await openRoom(page);

		await attachFile(page, createFilePayload('too-big.png', 'image/png', 10 * 1024 * 1024 + 1));
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.locator('.upload-error')).toContainText('File too large (max 10 MB)');
		const sentMedia = await page.evaluate(() => window.__fvE2E.getSentMedia());
		expect(sentMedia).toHaveLength(0);
	});

	test('shows expired image state for purged media', async ({ page }) => {
		await setupMediaRoom(page, [
			{
				id: 'image-expired',
				body: 'Expired image',
				type: 'image',
				mine: false,
				senderId: '@alice:example.test',
				senderName: 'Alice',
				media: {
					mxcUrl: 'mxc://example.test/image-expired',
					mimeType: 'image/png',
					size: 64,
					filename: 'expired.png',
					thumbnailUrl: null,
					durationSecs: null,
					waveformData: null
				}
			}
		]);
		await openRoom(page);
		await expect(page.locator('.expired-text')).toContainText('Media expired');
	});

	test('shows audio expired when remote media returns 404', async ({ page }) => {
		await setupMediaRoom(page, [
			{
				id: 'audio-expired',
				body: 'Expired audio',
				type: 'audio',
				mine: false,
				senderId: '@alice:example.test',
				senderName: 'Alice',
				media: {
					mxcUrl: 'mxc://example.test/audio-expired',
					mimeType: 'audio/mp4',
					size: 64,
					filename: 'expired.m4a',
					thumbnailUrl: null,
					durationSecs: 7,
					waveformData: null
				}
			}
		]);
		await openRoom(page);
		await page.locator('button[aria-label="Play"]').first().click();
		await expect(page.locator('.expired-text')).toContainText('Audio expired');
	});

	test('falls back to inline video playback when no thumbnail exists', async ({ page }) => {
		await setupMediaRoom(page, [
			{
				id: 'video-ok',
				body: 'Video without thumbnail',
				type: 'video',
				mine: false,
				senderId: '@alice:example.test',
				senderName: 'Alice',
				media: {
					mxcUrl: 'mxc://example.test/video-ok',
					mimeType: 'video/mp4',
					size: 64,
					filename: 'clip.mp4',
					thumbnailUrl: null,
					durationSecs: null,
					waveformData: null
				}
			}
		]);
		await openRoom(page);

		await expect(page.locator('text=Media expired')).toHaveCount(0);
		await page.locator('button[aria-label="Open video"]').click();
		await expect(page.locator('video.video-player')).toBeVisible();
	});

	test('records image download actions for remote images', async ({ page }) => {
		await setupMediaRoom(page, [
			{
				id: 'image-download',
				body: 'Download me',
				type: 'image',
				mine: false,
				senderId: '@alice:example.test',
				senderName: 'Alice',
				media: {
					mxcUrl: 'mxc://example.test/image-ok',
					mimeType: 'image/png',
					size: 64,
					filename: 'saved-image.png',
					thumbnailUrl: null,
					durationSecs: null,
					waveformData: null
				}
			}
		]);
		await openRoom(page);

		await page.locator('button[aria-label="Download image"]').click();
		await expect.poll(() => page.evaluate(() => window.__fvE2E.getDownloads().length)).toBe(1);
		const downloads = await page.evaluate(() => window.__fvE2E.getDownloads());
		expect(downloads[0].download).toBe('saved-image.png');
		expect(downloads[0].href).toContain('blob:');
	});
});
