// 建好網頁、放進殼（scripts/ios-web.mjs，#375）：放的是網頁的清單列的那些檔加清單自己，不放 service worker、PWA 的檔。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_BUNDLE_FILE, webBundle } from '../../scripts/web-bundle.mjs';
import { copyIntoShell } from '../../scripts/ios-web.mjs';

function write(dir: string, files: Record<string, string>) {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
}

/** 資料夾裡的每個檔（相對路徑，排好）。 */
function list(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true })
		.flatMap((d) => (d.isDirectory() ? list(dir, join(prefix, d.name)) : [join(prefix, d.name)]))
		.sort();
}

describe('建好網頁、放進殼', () => {
	it('放清單列的檔和清單自己；service worker、manifest、PWA 圖示不放；上次放的舊檔清掉', () => {
		const build = mkdtempSync(join(tmpdir(), 'ios-web-build-'));
		write(build, {
			'index.html': '<h1>編輯器</h1>',
			'200.html': '<h1>入口</h1>',
			'_app/immutable/entry/start.abc.js': 'console.log(1)',
			'sw.js': 'sw',
			'workbox-f73e7929.js': 'wb',
			'manifest.webmanifest': '{}',
			'pwa-192x192.png': 'png'
		});
		writeFileSync(join(build, WEB_BUNDLE_FILE), JSON.stringify(webBundle(build)));
		const out = join(mkdtempSync(join(tmpdir(), 'ios-web-out-')), 'Web.bundle');
		write(out, { 'old.js': '上次的' });

		copyIntoShell(build, out);

		expect(list(out)).toEqual(['200.html', '_app/immutable/entry/start.abc.js', 'index.html', WEB_BUNDLE_FILE]);
		expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('<h1>編輯器</h1>');
		expect(existsSync(join(out, 'old.js'))).toBe(false);
	});
});
