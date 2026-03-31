import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import jsYaml from 'js-yaml';
const { load: loadYaml } = jsYaml;
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Real E2E config — runs against the deployed server.
 * Usage: npx playwright test --config client/tests/e2e/playwright.real.config.ts
 *
 * Base URL is derived from E2E_BASE_URL first, then from the local root
 * config.yml if present. This keeps the existing maintainer workflow while
 * allowing public contributors to run against any deployment without a local
 * operator config file.
 *
 * Optional env vars:
 *   E2E_BASE_URL       — override the derived URL, e.g. https://my-server.duckdns.org:8443
 *   E2E_MATRIX_DOMAIN  — Matrix homeserver domain (defaults to hostname of base URL)
 *   E2E_ALICE_USER     — first test user username
 *   E2E_ALICE_PASS     — first test user password
 *   E2E_BOB_USER       — second test user username (will be registered if absent)
 *   E2E_BOB_PASS       — second test user password
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(__dirname, '../..');
const repoRoot   = resolve(__dirname, '../../..');
const configPath = resolve(repoRoot, 'config.yml');
const varsConfig = loadYaml(
	readFileSync(resolve(repoRoot, 'ansible/inventory/group_vars/all/vars.yml'), 'utf8')
);
const appConfig = existsSync(configPath)
	? loadYaml(readFileSync(configPath, 'utf8'))
	: null;

const derivedURL = appConfig
	? `https://${appConfig.duckdns_subdomain}.duckdns.org:${varsConfig.https_port}`
	: '';
const baseURL = process.env.E2E_BASE_URL || derivedURL;

if (!baseURL) {
	throw new Error(
		'Real E2E requires E2E_BASE_URL or a local config.yml with duckdns_subdomain configured.'
	);
}

export default defineConfig({
	testDir: resolve(__dirname, 'real'),
	fullyParallel: false,
	workers: 1, // Pi is a low-resource device — parallel Matrix clients cause login timeouts
	retries: 1,
	timeout: 90_000, // fresh-device Rust crypto init + first Matrix sync can take ~30–60s
	reporter: [['html', { outputFolder: resolve(clientRoot, 'playwright-report-real') }]],
	use: {
		baseURL,
		ignoreHTTPSErrors: true,
		trace: 'on-first-retry',
		video: 'on-first-retry',
		// Fake media devices so WebRTC getUserMedia() resolves in CI/headless mode
		launchOptions: {
			args: [
				'--use-fake-ui-for-media-stream',
				'--use-fake-device-for-media-stream',
			],
		},
		// Explicit permission grants — required even with fake media on secure origins
		permissions: ['microphone', 'camera'],
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
	],
	// No webServer — uses the real deployed instance
});
