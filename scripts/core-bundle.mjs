// 把流程核心打包成一個 JS 檔，給伺服器的 QuickJS 跑（ADR 0013），並算出這包的指紋。
// 前端（vite.config.ts）和伺服器（server/build.rs）都用這支算指紋，連上時比對；不用人改版本號。
//
//   node scripts/core-bundle.mjs <輸出資料夾>
//     寫出 flow-core.js（全域變數 flowCore）和 flow-core.fingerprint。

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src/lib/core/bundle-entry.ts');

/**
 * 打包流程核心，回程式碼和指紋（程式碼的 SHA-256）。
 * edit：打包前改某個檔的原始碼（測試用：改一行，指紋要變）。
 * @param {{ edit?: (path: string, code: string) => string }} [options]
 * @returns {Promise<{ code: string; fingerprint: string }>}
 */
export async function bundleCore({ edit } = {}) {
	const bundle = await rolldown({
		input: ENTRY,
		cwd: ROOT,
		// 不帶 Node 才有的東西：依賴選瀏覽器版（例：fflate）。
		platform: 'neutral',
		plugins: edit ? [{ name: 'edit', transform: (code, id) => edit(id, code) }] : []
	});
	const { output } = await bundle.generate({ format: 'iife', name: 'flowCore' });
	await bundle.close();
	const { code } = output[0];
	return { code, fingerprint: createHash('sha256').update(code).digest('hex') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const out = process.argv[2];
	if (!out) throw new Error('用法：node scripts/core-bundle.mjs <輸出資料夾>');
	const { code, fingerprint } = await bundleCore();
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, 'flow-core.js'), code);
	writeFileSync(join(out, 'flow-core.fingerprint'), fingerprint);
}
