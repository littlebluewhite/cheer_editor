import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { withPwa } from '@vite-pwa/sveltekit';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
	plugins: [
		// withPwa 包住 sveltekit()：產生 service worker（可離線）和 manifest。
		withPwa(
			{
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				// GitHub Pages 放在 /cheer_editor/ 底下；部署時由 BASE_PATH 帶入，本機開發是 /。
				paths: { base: base() }
			},
			{
				// 新版部署後，使用者重新整理：新 service worker 裝好就自動再載入一次，拿到新版。
				registerType: 'autoUpdate',
				manifest: {
					name: '競技啦啦隊流程編輯器',
					short_name: '流程編輯器',
					lang: 'zh-Hant-TW',
					display: 'standalone',
					theme_color: '#ffffff',
					background_color: '#ffffff',
					// 圖檔在 static/，由 scripts/app-icons.sh 從 favicon.svg 產生（見 docs/deploy.md）。
					icons: [
						{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
						{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
						{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
					]
				}
			}
		)
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				// 流程核心：純 TypeScript，在 Node 跑，碰不到 DOM。
				// 音訊薄層的播放器也在這裡測（Web Audio 換成假的，見 src/lib/audio/player.ts）。
				// src/lib 底下其他不碰 DOM 的小模組（例：編輯頁左右怎麼分）也在這裡測。
				extends: './vite.config.ts',
				test: {
					name: 'core',
					environment: 'node',
					include: ['src/lib/core/**/*.test.ts', 'src/lib/audio/**/*.test.ts', 'src/lib/*.test.ts'],
					exclude: ['src/**/*.svelte.test.ts']
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

function base(): '' | `/${string}` {
	const value = process.env.BASE_PATH ?? '';
	if (value !== '' && !value.startsWith('/')) throw new Error(`BASE_PATH 要以 / 開頭：${value}`);
	return value as '' | `/${string}`;
}
