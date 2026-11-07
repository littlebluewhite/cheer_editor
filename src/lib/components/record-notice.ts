// 記錄頁的「刪掉 → 救回」（卡片和全上那一排共用）。提示走編輯器唯一的提示（session.notice），同時只有一則。
import type { CommandResult } from '#lib/core';
import type { Ask } from '#lib/ask.svelte.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';

/**
 * 經過 ask 送刪掉的指令，成功就提示 text（寫出刪了哪一次，例「已刪掉 ·✓（第 4 次）」），旁邊有「救回」（留久一點）；
 * 按「救回」送 restore 拿刪掉的結果做的指令，成功就提示「已救回」。紀錄不算復原的一步，所以用「救回」不用「復原」。
 */
export function removeWithRestore<R extends CommandResult>(
	ask: Ask,
	session: EditorSession,
	text: string,
	remove: () => R,
	restore: (removed: Extract<R, { kind: 'ok' }>) => CommandResult
) {
	ask.send(remove, {
		done: (removed) =>
			session.toast(text, {
				label: '救回',
				run: () => ask.send(() => restore(removed), { done: () => (session.notice = '已救回') })
			})
	});
}
