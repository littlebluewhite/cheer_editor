// 畫面程式的寫法守門：同一件事只有一個做法，新寫的地方漏了就紅。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

/** src 底下的 .svelte 和 .ts（測試檔除外）。 */
function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return sourceFiles(path);
		if (!/\.(svelte|ts)$/.test(e.name) || /\.test\.ts$/.test(e.name)) return [];
		return [path];
	});
}

/** 拿掉註解（<!-- -->、/* *\/、//）：註解裡提到給工程師看沒關係。 */
function withoutComments(text: string): string {
	return text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** 每個檔裡符合 pattern 的行：「檔名: 那一行」。 */
function linesMatching(pattern: RegExp, files = sourceFiles(SRC)): string[] {
	return files.flatMap((file) =>
		withoutComments(readFileSync(file, 'utf8'))
			.split('\n')
			.filter((line) => pattern.test(line))
			.map((line) => `${relative(SRC, file)}: ${line.trim()}`)
	);
}

describe('檢視模式：畫面能不能改只看 session.editable（D）', () => {
	it('元件不直接讀 session.viewing 決定能不能改；留下的都是在講「檢視模式」這個狀態本身', () => {
		const svelteFiles = sourceFiles(SRC).filter((f) => f.endsWith('.svelte'));
		expect(linesMatching(/session!?\.viewing\b/, svelteFiles)).toEqual([
			// 窄螢幕一律是檢視模式：寫入狀態，不是在判斷
			'routes/+page.svelte: session.viewing = narrow;',
			'routes/+page.svelte: session.viewing = narrow;',
			// 檢視模式的標示：上方列變紫
			"routes/+page.svelte: <header class=\"topbar\" class:viewing={session.viewing && view === 'edit' && !narrow} bind:this={topbar}>",
			// 「編輯｜檢視」切換：顯示並切換這個狀態
			'routes/+page.svelte: <button type="button" aria-pressed={!session.viewing} onclick={() => (session.viewing = false)}',
			'routes/+page.svelte: aria-pressed={session.viewing}',
			'routes/+page.svelte: onclick={() => (session.viewing = true)}><Icon name="eye" />檢視</button',
			// 檢視模式的標示：場地框黃色、角落寫「檢視模式・只能看」
			"routes/+page.svelte: <main class=\"field-host\" class:viewing={session.viewing} hidden={view === 'practice'} {@attach watchFieldHostH}>",
			'routes/+page.svelte: {#if session.viewing}'
		]);
	});
});

describe('錯誤訊息自己捲出來（C1）', () => {
	it('role="alert" 只在 reveal.ts 的 revealAlert 標：每個被擋下的原因出現時都捲進看得到的範圍', () => {
		expect(linesMatching(/\brole\b\W{1,4}alert\b/)).toEqual(["lib/components/reveal.ts: el.setAttribute('role', 'alert');"]);
	});
});

describe('鍵盤路由只有一份定義（G）', () => {
	it("「焦點在不在打字的地方」都問 key-owner.ts，不自己寫 closest('input, …')", () => {
		expect(linesMatching(/closest\(\s*['"`]\s*(input|textarea|select)\b/)).toEqual([]);
	});
});
