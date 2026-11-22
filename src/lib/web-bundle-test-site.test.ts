// Mac 上的小網站（scripts/web-bundle-test-site.mjs，#394）：開發版的殼改去這裡抓網頁，輪流放四種。
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KINDS, testBundle } from '../../scripts/web-bundle-test-site.mjs';
import { webBundle } from '../../scripts/web-bundle.mjs';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** App 裡那包的樣子（Web.bundle）：幾個檔加清單。 */
function shellBundle(): string {
	const dir = mkdtempSync(join(tmpdir(), 'test-site-'));
	const files: Record<string, string> = {
		'index.html': '<!doctype html><html><head><title>編輯器</title></head><body></body></html>',
		'_app/a.js': 'console.log(1)'
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	writeFileSync(join(dir, 'web-bundle.json'), JSON.stringify(webBundle(dir)));
	return dir;
}

/** 放出去的每個檔，跟清單對不上的路徑。 */
function mismatched(b: ReturnType<typeof testBundle>) {
	return b.manifest.files.filter((f) => {
		const data = b.files.get(f.path);
		return !data || data.length !== f.size || sha(data) !== f.sha256;
	});
}

describe('Mac 上的小網站', () => {
	it('輪流放四種：新的一包、有一個檔對不上、壞掉的一包、要新版殼的一包', () => {
		expect(KINDS).toEqual(['new', 'mismatch', 'broken', 'tooOld']);
	});

	it('新的一包：跟 App 裡那包不一樣，每個檔都對得上清單', () => {
		const dir = shellBundle();
		const b = testBundle(dir, 'new', 't1');
		expect(b.manifest.id).not.toBe(webBundle(dir).id);
		expect(mismatched(b)).toEqual([]);
		expect(b.files.get('index.html')!.toString()).toContain('<title>編輯器</title>');
		expect(b.manifest.minShellBuild).toBeUndefined();
	});

	it('每次開的記號不一樣，代號就不一樣（換過的、退回過的不會擋住下一次）', () => {
		const dir = shellBundle();
		expect(testBundle(dir, 'new', 't1').manifest.id).not.toBe(testBundle(dir, 'new', 't2').manifest.id);
	});

	it('有一個檔對不上：只有一個', () => {
		const b = testBundle(shellBundle(), 'mismatch', 't1');
		expect(mismatched(b)).toHaveLength(1);
	});

	it('壞掉的一包：檔都對得上，但首頁不是編輯器（不會跟殼說好了）', () => {
		const b = testBundle(shellBundle(), 'broken', 't1');
		expect(mismatched(b)).toEqual([]);
		expect(b.files.get('index.html')!.toString()).not.toContain('<title>編輯器</title>');
	});

	it('要新版殼的一包：清單標很大的建置號，檔都對得上', () => {
		const b = testBundle(shellBundle(), 'tooOld', 't1');
		expect(b.manifest.minShellBuild).toBeGreaterThanOrEqual(1_000_000);
		expect(mismatched(b)).toEqual([]);
	});
});
