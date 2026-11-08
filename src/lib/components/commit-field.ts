// 改了離開就送出的欄位的接線，只寫這一次：`{@attach commitField(ask, '八拍數', {...})}`。
// 格名（field）：有自己紅字的欄位（被擋時 ask 寫「「格名」退回原本的值：…」）。
// null：紅字是表單上那一句（ask.error，被擋時寫「…，已還原」），例：一列一列的名字欄。
// - change（離開欄位、按 Enter）送出：打的字交給 send，被擋就把欄位退回 actual()，原因記在這一格（或表單上）。
//   要問（確認、保留／清掉）時欄位留著打的字，按取消才退回（N33）。
// - 打字（input）就收掉這一格的紅字（null：表單上的）：退回之後再打回原本的值送出時，change 被 pending-input 吞掉（值跟上次送出的一樣），
//   等送出才收紅字會一直留著（N34）。
// - Esc 丟掉打的字：pending-input 在中央處理（退回上次送出的值），這裡不用再接。

import type { Attachment } from 'svelte/attachments';
import { updateCustomRole, type CommandResult, type ConfirmOption, type CustomRole, type Flow } from '#lib/core';
import type { Ask } from '#lib/ask.svelte.js';

export interface FieldCommit<R extends CommandResult> {
	/** 送出打的字（送出那一刻的字；要確認時帶著回答再送一次，用的還是同一串）。 */
	send: (text: string, o: ConfirmOption) => R;
	/** 流程裡現在的值：被擋時欄位退回它。 */
	actual: () => string;
	/** 要確認時按了取消。 */
	cancel?: () => void;
}

export function commitField<R extends CommandResult>(
	ask: Ask,
	field: string | null,
	{ send, actual, cancel }: FieldCommit<R>
): Attachment<HTMLInputElement> {
	return (input) => {
		const onchange = () => {
			const text = input.value;
			ask.send((o: ConfirmOption = {}) => send(text, o), { field: field ?? undefined, revert: () => (input.value = actual()), cancel });
		};
		const oninput = () => ask.edited(field ?? undefined);
		input.addEventListener('change', onchange);
		input.addEventListener('input', oninput);
		return () => {
			input.removeEventListener('change', onchange);
			input.removeEventListener('input', oninput);
		};
	};
}

/** 自訂任務角色的名稱欄（流程設定、名詞對照表共用）：意思不變；被擋就退回原本的名稱，原因寫在表單上。 */
export function customRoleNameField(ask: Ask, flow: () => Flow, role: CustomRole): Attachment<HTMLInputElement> {
	return commitField(ask, null, {
		send: (text) => updateCustomRole(flow(), role.id, { name: text, meaning: role.meaning }),
		actual: () => role.name
	});
}
