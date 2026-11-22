// 建好網頁、放進殼（#375）：npm run build，再把網頁的清單（build/web-bundle.json）列的檔加清單自己放進 ios/App/Web.bundle。
// 跟網站部署的是同一包（不另外建 App 版），殼自己更新網頁時比的清單才對得上（ADR 0025）。
// 清單本來就不列 service worker、Workbox、manifest、PWA 圖示，所以 App 裡沒有這些。出版指令之後也用這支。
//
//   npm run ios:web            建、放
//   node scripts/ios-web.mjs --no-build   只放（已經建好）

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_BUNDLE_FILE } from './web-bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SHELL_WEB_DIR = join(ROOT, 'ios/App/Web.bundle');

/**
 * 建置資料夾裡清單列的檔和清單自己，放進 out（先整個清掉）。
 * @param {string} buildDir
 * @param {string} out
 */
export function copyIntoShell(buildDir, out) {
	/** @type {import('./web-bundle.mjs').WebBundle} */
	const bundle = JSON.parse(readFileSync(join(buildDir, WEB_BUNDLE_FILE), 'utf8'));
	rmSync(out, { recursive: true, force: true });
	for (const path of [...bundle.files.map((f) => f.path), WEB_BUNDLE_FILE]) {
		mkdirSync(dirname(join(out, path)), { recursive: true });
		copyFileSync(join(buildDir, path), join(out, path));
	}
	return bundle;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (!process.argv.includes('--no-build')) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
	const bundle = copyIntoShell(join(ROOT, 'build'), SHELL_WEB_DIR);
	console.log(`放進殼：${bundle.files.length} 個檔，代號 ${bundle.id.slice(0, 12)} → ios/App/Web.bundle`);
}
