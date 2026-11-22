// 網頁的清單（scripts/web-bundle.mjs、ADR 0025）：App 的殼照這份清單從網站抓新版網頁，每個檔比 SHA-256。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkWebBundle, sourceVersion, WEB_BUNDLE_FILE, webBundle } from '../../scripts/web-bundle.mjs';

/** 照建置結果的樣子放幾個檔。 */
function fakeBuild(): string {
	const dir = mkdtempSync(join(tmpdir(), 'web-bundle-'));
	const files: Record<string, string> = {
		'index.html': '<h1>編輯器</h1>',
		'200.html': '<h1>入口</h1>',
		'_app/immutable/entry/start.abc.js': 'console.log(1)',
		'favicon.svg': '<svg/>',
		// 下面這些不進清單：service worker、Workbox、PWA 的 manifest 和圖示
		'sw.js': 'sw',
		'workbox-f73e7929.js': 'wb',
		'manifest.webmanifest': '{}',
		'pwa-192x192.png': 'png',
		'pwa-512x512.png': 'png'
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

describe('網頁的清單', () => {
	it('列出建置結果的每個檔（路徑、大小、SHA-256），不含 service worker 和 PWA 的檔', () => {
		const bundle = webBundle(fakeBuild());
		expect(bundle.files).toEqual([
			{
				path: '200.html',
				size: 15,
				sha256: '8cd90298a32d903da9f16558a509d39e44b460b81e26523b43e8f329709eeca3'
			},
			expect.objectContaining({ path: '_app/immutable/entry/start.abc.js', size: 14 }),
			expect.objectContaining({ path: 'favicon.svg', size: 6 }),
			expect.objectContaining({ path: 'index.html', size: 18 })
		]);
		expect(bundle.id).toMatch(/^[0-9a-f]{64}$/);
		expect(bundle).not.toHaveProperty('minShellBuild');
	});

	it('一樣的檔，清單一樣；改了任何一個檔的一個字，整包的代號就不一樣', () => {
		const a = fakeBuild();
		const b = fakeBuild();
		expect(webBundle(b)).toEqual(webBundle(a));
		const before = webBundle(a).id;
		writeFileSync(join(a, '_app/immutable/entry/start.abc.js'), 'console.log(2)');
		expect(webBundle(a).id).not.toBe(before);
	});
});

describe('部署後的線上檢查：清單抓得到、每個檔的指紋對得上', () => {
	const servers: ReturnType<typeof createServer>[] = [];
	afterEach(() => {
		for (const s of servers.splice(0)) s.close();
	});

	/** 跟正式站的 Rust 伺服器一樣：有這個檔就給，找不到的路徑回 200.html，狀態還是 200（server/src/lib.rs）。 */
	async function serve(dir: string): Promise<string> {
		const server = createServer((req, res) => {
			const path = join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
			const file = existsSync(path) && !path.endsWith('/') ? path : join(dir, '200.html');
			res.writeHead(200).end(readFileSync(file));
		});
		servers.push(server);
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	}

	function deployed(): string {
		const dir = fakeBuild();
		writeFileSync(join(dir, WEB_BUNDLE_FILE), JSON.stringify(webBundle(dir)));
		return dir;
	}

	it('清單和每個檔都對：沒有問題', async () => {
		const result = await checkWebBundle(await serve(deployed()));
		expect(result).toEqual({ files: 4, problems: [] });
	});

	it('有一個檔內容對不上（例：新清單、舊檔）：檢查不過，說是哪個檔', async () => {
		const dir = deployed();
		writeFileSync(join(dir, 'favicon.svg'), '<svg>舊的</svg>');
		const { problems } = await checkWebBundle(await serve(dir));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('favicon.svg');
	});

	it('清單裡的檔不見了，伺服器回 200.html、狀態 200：檢查不會被騙過', async () => {
		const dir = deployed();
		rmSync(join(dir, '_app/immutable/entry/start.abc.js'));
		const { problems } = await checkWebBundle(await serve(dir));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('_app/immutable/entry/start.abc.js');
	});

	it('網站上沒有清單（拿到的是 200.html）：檢查不過', async () => {
		const dir = fakeBuild();
		const { problems } = await checkWebBundle(await serve(dir));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(WEB_BUNDLE_FILE);
	});
});

describe('建置的版本名字（SvelteKit 的 version.name）', () => {
	// 預設是建置當下的時間，同一個 commit 建兩次每頁 HTML 都不一樣，清單也跟著不一樣。
	function fakeRepo(): string {
		const root = mkdtempSync(join(tmpdir(), 'web-bundle-src-'));
		const files: Record<string, string> = {
			'src/routes/+page.svelte': '<h1>編輯器</h1>',
			'static/favicon.svg': '<svg/>',
			'messages/zh-TW.json': '{}',
			'package-lock.json': '{}',
			'vite.config.ts': 'export default {}'
		};
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(join(root, path, '..'), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		return root;
	}

	it('一樣的原始碼，名字一樣；改了一個字，名字就變', () => {
		const a = fakeRepo();
		expect(sourceVersion(a)).toBe(sourceVersion(fakeRepo()));
		const before = sourceVersion(a);
		writeFileSync(join(a, 'src/routes/+page.svelte'), '<h1>編輯器！</h1>');
		expect(sourceVersion(a)).not.toBe(before);
	});

	it('建置時才產生的翻譯函式（src/lib/paraglide）不算：第一次建和再建一次名字一樣', () => {
		const a = fakeRepo();
		const before = sourceVersion(a);
		mkdirSync(join(a, 'src/lib/paraglide'), { recursive: true });
		writeFileSync(join(a, 'src/lib/paraglide/runtime.js'), 'export {}');
		expect(sourceVersion(a)).toBe(before);
	});
});
