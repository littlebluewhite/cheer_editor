// 快捷鍵的寫法只有一個來源（shortcuts.ts）：畫面和使用說明不會一邊寫 ⌘⇧Z、一邊寫 ⇧⌘Z（N61）。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEYS } from './shortcuts';

const SRC = join(import.meta.dirname, '..');

/** src 底下的 .svelte 和 .ts（測試檔、shortcuts.ts 除外）。 */
function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return sourceFiles(path);
		if (!/\.(svelte|ts)$/.test(e.name) || /\.test\.ts$/.test(e.name) || e.name === 'shortcuts.ts') return [];
		return [path];
	});
}

/** 拿掉註解（<!-- -->、/* *\/、//）：註解裡寫 ⌘Z 給工程師看沒關係。 */
function withoutComments(text: string): string {
	return text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

describe('快捷鍵的寫法', () => {
	it('除了 shortcuts.ts，畫面和使用說明的程式裡沒有直接寫 ⌘ 或 Ctrl+（N61）', () => {
		const found = sourceFiles(SRC).flatMap((file) =>
			withoutComments(readFileSync(file, 'utf8'))
				.split('\n')
				.filter((line) => /⌘|Ctrl\+/.test(line))
				.map((line) => `${relative(SRC, file)}: ${line.trim().slice(0, 80)}`)
		);
		expect(found).toEqual([]);
	});

	it('Mac 的修飾鍵照 Apple HIG 的順序 Control、Option、Shift、Command：重做是 ⇧⌘Z', () => {
		expect(KEYS.redo.mac).toBe('⇧⌘Z');
		const ORDER = '⌃⌥⇧⌘';
		for (const { mac } of Object.values(KEYS)) {
			const at = [...mac].filter((c) => ORDER.includes(c)).map((c) => ORDER.indexOf(c));
			expect(at).toEqual([...at].sort((a, b) => a - b));
		}
	});
});
