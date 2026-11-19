import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { withPwa } from '@vite-pwa/sveltekit';
import { svelteTesting } from '@testing-library/svelte/vite';
import { bundleCore } from './scripts/core-bundle.mjs';
import { thirdPartyLicenses } from './scripts/third-party-licenses.ts';

export default defineConfig({
	// 舊網址版（GitHub Pages，#267）：建置時設 OLD_SITE=1 才是。見 src/lib/old-site.ts、docs/deploy.md。
	define: { __OLD_SITE__: JSON.stringify(process.env.OLD_SITE === '1') },
	plugins: [
		// 流程核心那包的指紋（__CORE_FINGERPRINT__），伺服器帶的是同一個（scripts/core-bundle.mjs、ADR 0010）。
		{
			name: 'core-fingerprint',
			config: async () => ({
				define: { __CORE_FINGERPRINT__: JSON.stringify((await bundleCore()).fingerprint) }
			})
		},
		// 建置時產生 third-party-licenses.txt（第三方套件的授權），見檔案開頭。
		thirdPartyLicenses(),
		// withPwa 包住 sveltekit()：產生 service worker（可離線）和 manifest。
		withPwa(
			{
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				// 200.html：沒有預先建好的路徑，Rust 伺服器回這頁，讓前端自己處理路由（server/src/lib.rs）。
				adapter: adapter({ fallback: '200.html' }),
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
				// 流程影片的版面（量字換成假的）也是。
				extends: './vite.config.ts',
				test: {
					name: 'core',
					environment: 'node',
					include: [
						'src/lib/core/**/*.test.ts',
						'src/lib/audio/**/*.test.ts',
						'src/lib/video/**/*.test.ts',
						'src/lib/file/**/*.test.ts',
						'src/lib/*.test.ts'
					],
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
					include: ['src/**/*.svelte.test.ts'],
					// Svelte 執行期警告算失敗（見檔案開頭）。
					setupFiles: ['./src/svelte-warnings.setup.ts']
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
