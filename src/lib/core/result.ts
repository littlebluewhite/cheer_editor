// 編輯指令的結果。每個指令都回傳其中一種，不丟例外、不改傳進來的流程。

import type { Flow } from './flow';
import { said, type Said, type Why } from './why';

export type CommandResult<Extra extends object = object> =
	/** 成功：新的流程。有些指令多帶一點結果（例：新加的那一筆的 id），寫在 Extra。 */
	| ({ kind: 'ok'; flow: Flow } & Extra)
	/** 被擋：流程沒變，message 是給教練看的原因（改成代號的多帶 why，見 why.ts）。 */
	| ({ kind: 'blocked' } & Said)
	/**
	 * 要確認：這樣改會連帶刪掉別的東西（段縮短、刪人）。流程沒變；
	 * 給教練看 message 和 items（會被刪掉的清單），按確定就帶 { confirmed: true } 再送一次同一個指令。
	 * confirmLabel：確定鈕的字跟著這個問題（例：只裁短是「確定裁短」）；沒給就照問的地方的（N19）。
	 */
	| ({ kind: 'confirm'; items: string[]; confirmLabel?: string } & Said)
	/**
	 * 要選保留還是清掉：有紀錄的組換了人、有紀錄的隊員改名。流程沒變；
	 * 給教練看 message 和 items（會被動到的紀錄），兩個選擇是「保留舊紀錄」「清掉重算」，
	 * 選好就帶 { records: 'keep' | 'clear' } 再送一次同一個指令。
	 */
	| ({ kind: 'choose'; items: string[] } & Said);

/**
 * 讀教練打的字（時間、長度、數字）：看得懂是 ok 帶 value；看不懂是被擋，message 是給教練看的原因。
 * 被擋跟指令被擋一樣，表單可以直接交給問教練。
 */
export type ReadResult<T> = { kind: 'ok'; value: T } | ({ kind: 'blocked' } & Said);

/** 讀到的值：null 是看不懂，擋下來說原因（中文，或代號，見 why.ts）。 */
export const readOr = <T>(value: T | null, reason: string | Why): ReadResult<T> =>
	value === null ? { kind: 'blocked', ...said(reason) } : { kind: 'ok', value };

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
/** 被擋：原因是中文，或代號（見 why.ts；中文照樣寫一份）。 */
export const blocked = (reason: string | Why): CommandResult<never> => ({ kind: 'blocked', ...said(reason) });
export const needsConfirm = (reason: string | Why, items: string[], confirmLabel?: string): CommandResult => ({
	kind: 'confirm',
	...said(reason),
	items,
	...(confirmLabel && { confirmLabel })
});
export const needsChoice = (reason: string | Why, items: string[]): CommandResult => ({
	kind: 'choose',
	...said(reason),
	items
});

/** 會清掉練習紀錄的確認框、選擇都寫這句：按復原，這一步清掉的紀錄會一起回來（ADR 0007）。 */
export const RECORDS_UNDOABLE = '（清掉的紀錄按「復原」會回來）';

/** 教練回答過了：按了確定、或選了保留／清掉。 */
export const answered = ({ confirmed, records }: ConfirmOption): boolean => !!confirmed || records !== undefined;
