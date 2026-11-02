// 編輯指令的結果。每個指令都回傳其中一種，不丟例外、不改傳進來的流程。

import type { Flow } from './flow';

export type CommandResult<Extra extends object = object> =
	/** 成功：新的流程。有些指令多帶一點結果（例：新加的那一筆的 id），寫在 Extra。 */
	| ({ kind: 'ok'; flow: Flow } & Extra)
	/** 被擋：流程沒變，message 是給教練看的原因。 */
	| { kind: 'blocked'; message: string }
	/**
	 * 要確認：這樣改會連帶刪掉別的東西（段縮短、刪人）。流程沒變；
	 * 給教練看 message 和 items（會被刪掉的清單），按確定就帶 { confirmed: true } 再送一次同一個指令。
	 */
	| { kind: 'confirm'; message: string; items: string[] };

/** 會連帶刪東西的指令多帶的選項。 */
export interface ConfirmOption {
	/** 教練已經看過清單、按了確定。 */
	confirmed?: boolean;
}

export const ok = (flow: Flow): CommandResult => ({ kind: 'ok', flow });
export const blocked = (message: string): CommandResult<never> => ({ kind: 'blocked', message });
export const needsConfirm = (message: string, items: string[]): CommandResult => ({
	kind: 'confirm',
	message,
	items
});
