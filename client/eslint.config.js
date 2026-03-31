import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default [
	js.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'always'],
			curly: ['error', 'multi-line'],
			'no-throw-literal': 'error',
			'no-empty': ['error', { allowEmptyCatch: false }],
			'no-implicit-coercion': 'error',
			'no-shadow': 'warn',
			'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': ['warn', { max: 30, skipBlankLines: true, skipComments: true }],
			'max-params': ['warn', { max: 3 }],
			'max-depth': ['warn', { max: 3 }]
		}
	},
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: ts.parser,
			sourceType: 'module'
		},
		plugins: {
			'@typescript-eslint': ts.plugin
		},
		rules: {
			...ts.configs.recommended[1].rules,
			...ts.configs.recommended[2].rules
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		},
		rules: {
			'max-lines': ['warn', { max: 150, skipBlankLines: true, skipComments: true }]
		}
	},
	{
		files: ['**/*.test.js', '**/*.spec.js', '**/*.test.ts', '**/*.spec.ts'],
		rules: {
			'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': 'off',
			'no-console': 'off'
		}
	},
	{
		ignores: ['build/', '.svelte-kit/', 'node_modules/', 'playwright-report*/', 'e2e/']
	}
];
