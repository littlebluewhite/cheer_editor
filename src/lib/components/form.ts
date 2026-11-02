// 畫面元件共用的小工具：把流程核心的指令結果交出去、讀數字欄位。

import type { CommandResult, Flow } from '#lib/core';

/** 成功就把新流程交給 onchange，回空字串；被擋（或要確認）回給教練看的原因。 */
export function applyResult(r: CommandResult, onchange: (flow: Flow) => void): string {
	if (r.kind !== 'ok') return r.message;
	onchange(r.flow);
	return '';
}

/** 數字欄位 onchange 時的值（空白或看不懂是 NaN，交給流程核心擋）。 */
export const numberValue = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber;
