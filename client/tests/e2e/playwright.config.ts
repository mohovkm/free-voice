import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(__dirname, '../..');

export default defineConfig({
	testDir: resolve(__dirname, 'local'),
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry',
		launchOptions: {
			args: [
				'--use-fake-ui-for-media-stream',
				'--use-fake-device-for-media-stream'
			]
		}
	},
	projects: [
		{ name: 'mobile', use: { ...devices['Pixel 7'], serviceWorkers: 'block' } },
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' } }
	],
	webServer: {
		cwd: clientRoot,
		command: 'npm run build && npm run preview -- --host 127.0.0.1',
		port: 4173,
		reuseExistingServer: true
	}
});
