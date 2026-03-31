import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const clientSrc = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			'@client': clientSrc
		}
	},
	optimizeDeps: {
		// Rust crypto WASM module must not be pre-bundled by Vite — it self-initialises at runtime
		exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
	},
	test: {
		include: ['tests/unit/**/*.test.{js,ts}'],
		environment: 'happy-dom',
		setupFiles: ['src/test-setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			reportsDirectory: 'coverage/unit'
		},
		pool: 'forks',
		poolOptions: {
			forks: {
				execArgv: ['--no-experimental-webstorage']
			}
		}
	}
});
