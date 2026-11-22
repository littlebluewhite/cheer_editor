// Mac 上的小網站（#394）：沒有測試站，模擬器、真機的開發版（Debug）改來這裡抓網頁，試殼自己更新網頁的四種情形。
// 從 App 裡那包（ios/App/Web.bundle，先跑 npm run ios:web）做出四種，輪流放（按 Enter 換下一種）：
//   new       新的一包（index.html 多一個記號）：殼下載、回到首頁換上
//   mismatch  有一個檔對不上清單：殼整包丟掉，照舊
//   broken    壞掉的一包（首頁不是編輯器，不會跟殼說好了）：換上後 10 秒退回，以後不再抓這包
//   tooOld    清單標「要新版殼」（minShellBuild 很大）：殼不換；被擋的畫面寫「這版 App 太舊」
// 每次開，記號帶開的時間：代號跟上次不一樣，上次換上、退回過的不會擋住這次。
//
//   node scripts/web-bundle-test-site.mjs [new|mismatch|broken|tooOld] [--port 8787]
//   SIMCTL_CHILD_CHEER_WEB_BUNDLE_URL=http://127.0.0.1:8787/ xcrun simctl launch <模擬器> <bundle id>
// 真機要用 Mac 的區網 IP，Debug 版才收這個設定（ios/README.md「殼自己更新網頁」）。只用 Node 內建的東西。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_BUNDLE_FILE } from './web-bundle.mjs';

export const KINDS = /** @type {const} */ (['new', 'mismatch', 'broken', 'tooOld']);
/** 要新版殼的一包標的建置號：比哪個殼都大。 */
const TOO_NEW_BUILD = 1_000_000;

/** @param {Buffer} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * 從 App 裡那包（dir，有 web-bundle.json）做出一種：要放出去的檔和清單。清單照 scripts/web-bundle.mjs 的算法重算。
 * @param {string} dir
 * @param {(typeof KINDS)[number]} kind
 * @param {string} tag 記號（每次開不一樣）
 */
export function testBundle(dir, kind, tag) {
	/** @type {import('./web-bundle.mjs').WebBundle} */
	const original = JSON.parse(readFileSync(join(dir, WEB_BUNDLE_FILE), 'utf8'));
	/** @type {Map<string, Buffer>} */
	const files = new Map(original.files.map((f) => [f.path, readFileSync(join(dir, f.path))]));
	const mark = `<meta name="x-web-bundle" content="${kind}-${tag}">`;
	const index = files.get('index.html')?.toString() ?? '';
	files.set(
		'index.html',
		Buffer.from(kind === 'broken' ? `<!doctype html><html><head>${mark}<title>broken</title></head><body>壞掉的一包</body></html>` : index.replace('<head>', `<head>${mark}`))
	);
	const listed = [...files.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, data]) => ({ path, size: data.length, sha256: sha256(data) }));
	const id = sha256(Buffer.from(listed.map((f) => `${f.sha256}  ${f.path}\n`).join('')));
	if (kind === 'mismatch') {
		// 清單照上面算，放出去的 index.html 多一個字：殼比 SHA-256 對不上
		files.set('index.html', Buffer.concat([files.get('index.html') ?? Buffer.alloc(0), Buffer.from(' ')]));
	}
	/** @type {import('./web-bundle.mjs').WebBundle} */
	const manifest = { id, files: listed, ...(kind === 'tooOld' && { minShellBuild: TOO_NEW_BUILD }) };
	return { files, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const portAt = args.indexOf('--port');
	const port = portAt >= 0 ? Number(args[portAt + 1]) : 8787;
	const first = KINDS.indexOf(/** @type {any} */ (args.find((a) => KINDS.includes(/** @type {any} */ (a))) ?? 'new'));
	const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'ios/App/Web.bundle');
	const tag = String(Date.now());
	let at = first;
	let current = testBundle(dir, KINDS[at], tag);
	const show = () => console.log(`現在放：${KINDS[at]}（代號 ${current.manifest.id.slice(0, 12)}）。按 Enter 換下一種。`);

	createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).slice(1);
		const body = path === WEB_BUNDLE_FILE ? Buffer.from(JSON.stringify(current.manifest)) : current.files.get(path);
		console.log(`${req.method} /${path} → ${body ? 200 : 404}`);
		res.writeHead(body ? 200 : 404, { 'cache-control': 'no-store' });
		res.end(body ?? '');
	}).listen(port, '0.0.0.0', () => {
		console.log(`Mac 上的小網站：http://127.0.0.1:${port}/`);
		show();
	});
	process.stdin.on('data', () => {
		at = (at + 1) % KINDS.length;
		current = testBundle(dir, KINDS[at], tag);
		show();
	});
}
