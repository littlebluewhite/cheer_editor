import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				// 流程核心：純 TypeScript，在 Node 跑，碰不到 DOM。
				extends: './vite.config.ts',
				test: {
					name: 'core',
					environment: 'node',
					include: ['src/lib/core/**/*.test.ts']
				}
			},
			{
				// 畫面元件：jsdom。SVG 座標的做法見 docs/adr/0002-component-tests-jsdom.md。
				// 測試檔放在元件旁邊，檔名 *.svelte.test.ts。
				extends: './vite.config.ts',
				plugins: [svelteTesting()],
				test: {
					name: 'components',
					environment: 'jsdom',
					include: ['src/**/*.svelte.test.ts']
				}
			}
		]
	}
});
