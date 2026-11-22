// 網頁的清單（ADR 0025）：App 的殼照這份清單從自己的網站抓新版網頁，每個檔比 SHA-256，有一個對不上就整包丟掉。
// npm run build 建完網頁後跑這支，寫出 build/web-bundle.json，跟網頁一起進映像檔（網址 /web-bundle.json，見 docs/deploy.md）。
// 部署後 scripts/check-live.mjs 用 checkWebBundle 抓清單、比每個檔。那邊沒有 npm ci，所以這支只用 Node 內建的東西。
//
//   node scripts/web-bundle.mjs <建置資料夾>

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_BUNDLE_FILE = 'web-bundle.json';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 要第幾版以上的殼（比建置號，docs/deploy.md）。平常是 undefined，清單裡就不寫。
 * 新網頁真的沒辦法在舊殼上跑才填（ADR 0025）。
 * @type {number | undefined}
 */
const MIN_SHELL_BUILD = undefined;

/** 不進清單的檔：清單自己、service worker、Workbox、PWA 的 manifest 和圖示（殼用不到）。 */
const EXCLUDED = [/^web-bundle\.json$/, /^sw\.js$/, /^workbox-[^/]*\.js$/, /^manifest\.webmanifest$/, /^pwa-[^/]*\.png$/];

/**
 * @typedef {{ path: string; size: number; sha256: string }} WebBundleFile
 * @typedef {{ id: string; files: WebBundleFile[]; minShellBuild?: number }} WebBundle
 */

/** @param {string | Buffer | Uint8Array} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * 建置資料夾的清單。路徑用 / 分開、照字元排好；整包的代號是每個檔的路徑和 SHA-256 再算一次 SHA-256，
 * 任何一個檔改了，代號就不一樣。
 * @param {string} dir
 * @returns {WebBundle}
 */
export function webBundle(dir) {
	const files = walk(dir)
		.map((full) => relative(dir, full).split(sep).join('/'))
		.filter((path) => !EXCLUDED.some((re) => re.test(path)))
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((path) => {
			const data = readFileSync(join(dir, path));
			return { path, size: data.length, sha256: sha256(data) };
		});
	const id = sha256(files.map((f) => `${f.sha256}  ${f.path}\n`).join(''));
	return { id, files, ...(MIN_SHELL_BUILD !== undefined && { minShellBuild: MIN_SHELL_BUILD }) };
}

/** 會改變建出來的網頁的原始碼（相對 repo 根目錄）。映像檔裡沒有 .git（.dockerignore），所以不用 commit 的代號。 */
const SOURCES = ['src', 'static', 'messages', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'project.inlang/settings.json'];
/** 建置時才產生的，第一次建時還沒有：不算進去。 */
const GENERATED = /^src\/lib\/paraglide\/|(^|\/)\.DS_Store$/;

/**
 * 建置的版本名字（vite.config.ts 給 SvelteKit 的 version.name）：原始碼的 SHA-256。
 * SvelteKit 預設用建置當下的時間，每頁 HTML 都帶著它，同一個 commit 建兩次清單就不一樣。
 * 原始碼改了名字才變，SvelteKit 照樣認得出「網站換新版了」。
 * @param {string} [root] repo 根目錄
 * @returns {string}
 */
export function sourceVersion(root = ROOT) {
	const lines = SOURCES.filter((p) => existsSync(join(root, p)))
		.flatMap((p) => walk(join(root, p)))
		.map((full) => relative(root, full).split(sep).join('/'))
		.filter((path) => !GENERATED.test(path))
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((path) => `${sha256(readFileSync(join(root, path)))}  ${path}\n`);
	return sha256(lines.join('')).slice(0, 16);
}

/**
 * 部署後的線上檢查：抓網站上的清單，清單裡每個檔抓下來比大小和 SHA-256。
 * 伺服器找不到檔時回 200.html、狀態還是 200（server/src/lib.rs），所以不看狀態碼，只看內容：
 * 清單要是看得懂的 JSON，每個檔的指紋要對得上。
 * @param {string} site 網站的網址，例 https://littlebluewhite.com
 * @returns {Promise<{ files: number; problems: string[] }>}
 */
export async function checkWebBundle(site) {
	const base = site.replace(/\/$/, '');
	/** @type {WebBundle} */
	let bundle;
	try {
		bundle = await (await fetch(`${base}/${WEB_BUNDLE_FILE}`)).json();
		if (typeof bundle?.id !== 'string' || !Array.isArray(bundle.files)) throw new Error('不是清單的樣子');
	} catch (e) {
		return { files: 0, problems: [`${base}/${WEB_BUNDLE_FILE} 抓不到或看不懂：${e}`] };
	}
	const problems = [];
	for (const { path, size, sha256: expected } of bundle.files) {
		const url = `${base}/${path.split('/').map(encodeURIComponent).join('/')}`;
		try {
			const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
			const got = sha256(data);
			if (data.length !== size || got !== expected)
				problems.push(`${path} 對不上：清單 ${size} bytes ${expected.slice(0, 12)}，網站 ${data.length} bytes ${got.slice(0, 12)}`);
		} catch (e) {
			problems.push(`${path} 抓不到：${e}`);
		}
	}
	return { files: bundle.files.length, problems };
}

/** 資料夾底下的每個檔（給的是檔就是它自己）。 @param {string} path @returns {string[]} */
function walk(path) {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const out = process.argv[2];
	if (!out) throw new Error('用法：node scripts/web-bundle.mjs <建置資料夾>');
	const bundle = webBundle(resolve(out));
	writeFileSync(join(out, WEB_BUNDLE_FILE), JSON.stringify(bundle, null, '\t') + '\n');
	console.log(`${WEB_BUNDLE_FILE}：${bundle.files.length} 個檔，代號 ${bundle.id.slice(0, 12)}`);
}
