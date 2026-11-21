// 練習的權限（#318）：能不能記、誰記的、共用紀錄、只看自己的、沒存進去的、還沒傳的，收成一個東西。
// 編輯 session 帶著一個（session.practice），練習畫面、卡片、全上都從它拿。
// 管：這六個值長什麼樣子，和本機流程（還有用分享連結看的）那一個「都可以」的。
// 不管：雲端流程的值怎麼算、什麼時候變（CloudSteps 擁有、跟著權限和房間改），也不管改編排的鎖（session.readOnly）。

import type { DroppedRecord } from '#lib/editor-session.svelte.js';

export interface PracticeRights {
	/** 不能記的原因（雲端流程的檢視者：你只能看這支流程）：有的話「記」都擋下說這句。空字串是能記。 */
	readonly cannotRecord: string;
	/**
	 * 雲端流程不是自己記的那幾次：一次的 id → 記的人的名字（卡片、總表明細的記號後面寫）；沒有記的人（從流程檔來的）是 ''。
	 * 自己記的不在裡面（本機流程是空的：全是自己的）。
	 */
	readonly recordedBy: Readonly<Record<string, string>>;
	/** 雲端流程（#258）：紀錄有好幾個人記，卡片的「刪掉上一次」寫成「刪掉我的上一次」（本來就只刪自己記的）。 */
	readonly sharedRecords: boolean;
	/** 雲端流程的記錄者（#258）：只能改、刪自己記的；「刪掉我上一次全上記的」只刪自己在那次記的組。 */
	readonly ownRecordsOnly: boolean;
	/** 雲端流程沒存進去的紀錄（教練改了流程）：練習畫面上紅色一條，按「知道了」才清掉。 */
	readonly droppedRecords: readonly DroppedRecord[];
	/** 雲端流程還沒傳上去的那幾次的 id（#260）：卡片「這天的每一次」那一次後面黃色「沒傳」。 */
	readonly unsentRecords: ReadonlySet<string>;
}

/** 本機流程：都可以（能記、全是自己記的、沒有沒存進去的、沒有還沒傳的）。 */
export const ALL_ALLOWED: PracticeRights = Object.freeze({
	cannotRecord: '',
	recordedBy: Object.freeze({}),
	sharedRecords: false,
	ownRecordsOnly: false,
	droppedRecords: Object.freeze([]),
	unsentRecords: new Set<string>()
});
