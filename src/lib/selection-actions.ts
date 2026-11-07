// 選人工具列和右鍵選單共用的「現在可以做的事」：兩邊都照這一份清單畫，項目一樣、做的事一樣。
// 每一項只給「選到的人的新位置怎麼算」；插站位、往後帶、一步復原都走 moveGroup（跟拖人同一條路，見 SelectionTools）。

import { alignColumn, alignRow, mirrorPositions, spreadEvenly, type Flow, type Position } from '#lib/core';

export interface SelectionAction {
	/** 按鈕和選單上的字。 */
	label: string;
	/** 滑鼠停著時的說明。 */
	title: string;
	/** 至少選幾個人才出現。 */
	min: number;
	/** 收在同一個「名字 ▾」底下的一組（例：對齊）；沒有就自己一顆鈕。 */
	group?: string;
	/** 選到的人在這一拍的位置 → 新位置。zoom 是場地放大倍數（吸附用，跟拖人一樣）。 */
	place: (flow: Flow, pos: Record<string, Position>, zoom: number) => Record<string, Position>;
}

const ACTIONS: SelectionAction[] = [
	{
		label: '鏡像',
		title: '以場地左右中線為軸，左右對調（照正面看的方向），前後不變；站在中線上的人不動',
		min: 1,
		place: (flow, pos, zoom) => mirrorPositions(flow.field, pos, zoom)
	},
	{
		label: '排成一橫排',
		title: '前後位置一樣：取大家前後位置的平均，再吸附；左右不變',
		min: 2,
		group: '對齊',
		place: (flow, pos, zoom) => alignRow(flow.field, pos, zoom)
	},
	{
		label: '排成一直排',
		title: '左右位置一樣：取大家左右位置的平均，再吸附；前後不變',
		min: 2,
		group: '對齊',
		place: (flow, pos, zoom) => alignColumn(flow.field, pos, zoom)
	},
	{
		label: '平均分開',
		title: '兩端的人不動，中間的人照順序排在兩端之間，間隔一樣，再吸附',
		min: 3,
		place: (flow, pos, zoom) => spreadEvenly(flow.field, pos, zoom)
	}
];

/** 選了 count 個人時，工具列和右鍵選單上有的項目（照順序）。 */
export function selectionActions(count: number): SelectionAction[] {
	return ACTIONS.filter((a) => count >= a.min);
}
