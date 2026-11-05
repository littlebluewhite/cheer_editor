// 動作：一群隊員在一個段裡一起做的一件事。時間存段 ＋ 段內整數時間
// （音樂段是第幾個半拍，口號段是第幾個 0.1 秒），不存全域秒數。
// 這裡是動作的資料型別和小工具（型別、名字、換掉一個動作、大類清單、在全域秒數上的開始和結束）；
// 動作的指令在 actions.ts。別的核心檔只依賴這一個。

import type { Cue } from './cues';
import type { Flow } from './flow';
import type { SuccessRate } from './success-rate';
import { toSeconds } from './time';

/** 大類，固定 7 個，不能自訂。流程檔存英文代號。 */
export type ActionCategory = 'stunt' | 'pyramid' | 'toss' | 'tumbling' | 'jump' | 'dance' | 'other';

export const ACTION_CATEGORIES: { key: ActionCategory; label: string }[] = [
	{ key: 'stunt', label: '技巧' },
	{ key: 'pyramid', label: '金字塔' },
	{ key: 'toss', label: '拋投' },
	{ key: 'tumbling', label: '騰翻' },
	{ key: 'jump', label: '跳躍' },
	{ key: 'dance', label: '舞蹈' },
	{ key: 'other', label: '其他' }
];

export interface ActionMember {
	memberId: string;
	/** 任務角色的名稱（固定或自訂）；沒掛是 null。 */
	role: string | null;
	/** 組 id（g1、g2…，只在這個動作裡有意義；第幾組照 squadsOf 算）；沒有就是沒分組（舊流程檔沒有這個欄位）。 */
	squad?: string;
}

export interface Action {
	id: string;
	segmentId: string;
	category: ActionCategory;
	name: string;
	/** 段內第幾個半拍／0.1 秒開始。 */
	start: number;
	/** 幾個半拍／0.1 秒。 */
	length: number;
	note: string;
	members: ActionMember[];
	/** 辨識色（#rrggbb）：教練自己挑來認動作的顏色；沒有就用大類的顏色（舊流程檔沒有這個欄位）。 */
	color?: string;
	/** 這個動作的拍點；沒有就是空的（舊流程檔沒有這個欄位）。 */
	cues?: Cue[];
	/** 成功率的設定：有環節才有；沒有就是不記成功率（舊流程檔沒有這個欄位）。 */
	successRate?: SuccessRate;
}

/** 加動作的輸入：新動作一定沒有環節，所以不收成功率設定；人身上只收別的動作的組（從別的動作複製人）。 */
export type NewActionInput = Omit<Action, 'id' | 'successRate'>;

/** 改動作的欄位（成功率設定由環節的指令改；人身上的組可以帶，例：從別的動作複製人）。 */
export type ActionChanges = Partial<Omit<Action, 'id' | 'successRate'>>;

/** 流程裡換掉這個動作（照 id 找）。 */
export function replaceAction(flow: Flow, action: Action): Flow {
	return { ...flow, actions: flow.actions.map((a) => (a.id === action.id ? action : a)) };
}

/** 大類的名字：「技巧」。 */
export function categoryLabel(category: ActionCategory): string {
	return ACTION_CATEGORIES.find((c) => c.key === category)?.label ?? '';
}

/** 給教練看的動作名字：「技巧·Lib」；沒取名、名稱跟大類一樣（「舞蹈」）就只寫大類。 */
export function actionLabel(action: Pick<Action, 'category' | 'name'>): string {
	const category = categoryLabel(action.category);
	return action.name && action.name !== category ? `${category}·${action.name}` : category;
}

/** 動作在全域秒數上的開始和結束（結束那一刻不算在動作裡）。 */
export function actionSeconds(flow: Flow, action: Action): { startSec: number; endSec: number } {
	const { segmentId, start, length } = action;
	return {
		startSec: toSeconds(flow, { segmentId, at: start }),
		endSec: toSeconds(flow, { segmentId, at: start + length })
	};
}
