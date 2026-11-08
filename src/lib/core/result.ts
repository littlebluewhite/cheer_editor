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
	| { kind: 'confirm'; message: string; items: string[] }
	/**
	 * 要選保留還是清掉：有紀錄的組換了人、有紀錄的隊員改名。流程沒變；
	 * 給教練看 message 和 items（會被動到的紀錄），兩個選擇是「保留舊紀錄」「清掉重算」，
	 * 選好就帶 { records: 'keep' | 'clear' } 再送一次同一個指令。
	 */
	| { kind: 'choose'; message: string; items: string[] };

/**
 * 讀教練打的字（時間、長度、數字）：看得懂是 ok 帶 value；看不懂是被擋，message 是給教練看的原因。
 * 被擋跟指令被擋一樣，表單可以直接交給問教練。
 */
export type ReadResult<T> = { kind: 'ok'; value: T } | { kind: 'blocked'; message: string };

/** 讀到的值：null 是看不懂，擋下來說 message。 */
export const readOr = <T>(value: T | null, message: string): ReadResult<T> =>
	value === null ? { kind: 'blocked', message } : { kind: 'ok', value };

/** 紀錄的兩個選擇：保留舊紀錄（只是改錯字）或清掉重算（真的換人了）。 */
export type RecordsChoice = 'keep' | 'clear';

/** 會連帶刪東西的指令多帶的選項。 */
export interface ConfirmOption {
	/** 教練已經看過清單、按了確定。 */
	confirmed?: boolean;
	/** 教練選了保留舊紀錄還是清掉重算（也算按了確定）。 */
	records?: RecordsChoice;
}

/** 成功；extra 是指令多帶的結果（見 CommandResult）。 */
export const ok = <Extra extends object = object>(
	flow: Flow,
	extra?: Extra
): CommandResult<Extra> => ({ kind: 'ok', flow, ...(extra as Extra) });
export const blocked = (message: string): CommandResult<never> => ({ kind: 'blocked', message });
export const needsConfirm = (message: string, items: string[]): CommandResult => ({
	kind: 'confirm',
	message,
	items
});
export const needsChoice = (message: string, items: string[]): CommandResult => ({
	kind: 'choose',
	message,
	items
});

/** 會清掉練習紀錄的確認框、選擇都寫這句：按復原，這一步清掉的紀錄會一起回來（ADR 0007）。 */
export const RECORDS_UNDOABLE = '（清掉的紀錄按「復原」會回來）';

/** 教練回答過了：按了確定、或選了保留／清掉。 */
export const answered = ({ confirmed, records }: ConfirmOption): boolean => !!confirmed || records !== undefined;
