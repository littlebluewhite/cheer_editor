// 只放「機器一定抓得到、人常漏看」的規則，跟著 npm run check 一起跑（CI 也會跑）。
// 要加新規則時，先確定現有的程式碼不會一次冒出一堆錯。
import { defineConfig } from 'eslint/config';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import vitest from '@vitest/eslint-plugin';

const IME = '輸入法選字要用 src/lib/ime.ts 的 composing(e)，不要自己判斷 isComposing / keyCode（Safari 選字時 isComposing 是 false）。';

export default defineConfig(
	{ ignores: ['.svelte-kit/', 'build/', 'node_modules/', 'prototypes/', 'static/'] },
	{ files: ['**/*.ts'], languageOptions: { parser: ts.parser } },
	...svelte.configs.base,
	{ files: ['**/*.svelte', '**/*.svelte.ts'], languageOptions: { parserOptions: { parser: ts.parser } } },
	{
		files: ['src/**/*.{ts,svelte}'],
		ignores: ['src/lib/ime.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{ selector: "MemberExpression[property.name='isComposing']", message: IME },
				{ selector: "MemberExpression[property.name='keyCode']", message: IME }
			]
		}
	},
	{
		files: ['src/**/*.test.ts'],
		plugins: { vitest },
		// 同一層兩個一樣名字的 describe / it：通常是同一段測試被貼了兩次
		rules: { 'vitest/no-identical-title': 'error' }
	}
);
