// 快捷鍵怎麼寫：畫面的 title、提示和使用說明都從這裡拿，不要在別的地方直接寫 ⌘ 或 Ctrl+
// （src/lib/shortcuts.test.ts 會擋）。
// Mac 的修飾鍵照 Apple HIG 的順序：Control、Option、Shift、Command，所以重做是 ⇧⌘Z。

export interface Shortcut {
	/** Mac 的寫法。 */
	mac: string;
	/** Windows（和其他）的寫法；不只一個時照順序列。 */
	other: readonly string[];
}

export const KEYS = {
	undo: { mac: '⌘Z', other: ['Ctrl+Z'] },
	redo: { mac: '⇧⌘Z', other: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
	save: { mac: '⌘S', other: ['Ctrl+S'] },
	copy: { mac: '⌘C', other: ['Ctrl+C'] },
	paste: { mac: '⌘V', other: ['Ctrl+V'] },
	print: { mac: '⌘P', other: ['Ctrl+P'] },
	/** 按住它滾滾輪：放大縮小。 */
	zoom: { mac: '⌘', other: ['Ctrl'] }
} as const satisfies Record<string, Shortcut>;

/** Windows 的寫法，好幾個用「、」連起來（例：Ctrl+Shift+Z、Ctrl+Y）。 */
export function others(s: Shortcut): string {
	return s.other.join('、');
}

/** Mac 和 Windows 一起寫（例：⌘Z／Ctrl+Z）。 */
export function both(s: Shortcut): string {
	return `${s.mac}／${others(s)}`;
}
