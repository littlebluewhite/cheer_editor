// 編輯指令的結果。每個指令都回傳其中一種，不丟例外、不改傳進來的流程。
// 之後要「先確認」的指令（段縮短、刪人）再加第三種：{ kind: 'confirm', ... }。

import type { Flow } from './flow';

export type CommandResult =
	/** 成功：新的流程。 */
	| { kind: 'ok'; flow: Flow }
	/** 被擋：流程沒變，message 是給教練看的原因。 */
	| { kind: 'blocked'; message: string };

export const ok = (flow: Flow): CommandResult => ({ kind: 'ok', flow });
export const blocked = (message: string): CommandResult => ({ kind: 'blocked', message });
