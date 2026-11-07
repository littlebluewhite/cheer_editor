// 選人工具列和右鍵選單共用的「現在可以做的事」：兩邊都照這一份清單畫，項目一樣、做的事一樣。
// 每一項只給「選到的人的新位置怎麼算」；插站位、往後帶、一步復原都走 moveGroup（跟拖人同一條路，見 SelectionTools）。

import { mirrorPositions, type Flow, type Position } from '#lib/core';

export interface SelectionAction {
	/** 按鈕和選單上的字。 */
	label: string;
	/** 滑鼠停著時的說明。 */
	title: string;
	/** 至少選幾個人才出現。 */
	min: number;
	/**
	 * 選到的人在這一拍的位置 → 新位置。zoom 是場地放大倍數（吸附用，跟拖人一樣）。
	 * n：有 nth 的項目才有，框裡打的第幾張站位（一定有那一張）。
	 */
	place: (flow: Flow, pos: Record<string, Position>, zoom: number, n: number) => Record<string, Position>;
	/** 有的話：label 裡的 [_] 是一個「第幾張站位」數字框（例：跟第 [_] 張一樣），框的值給 place 的 n。 */
	nth?: true;
}

const ACTIONS: SelectionAction[] = [
	{
		label: '鏡像',
		title: '以場地左右中線為軸，左右對調（照正面看的方向），前後不變；站在中線上的人不動',
		min: 1,
		place: (flow, pos, zoom) => mirrorPositions(flow.field, pos, zoom)
	},
	{
		label: '跟第 [_] 張一樣',
		title: '選到的人改到那一張站位裡的位置；沒選人就是全隊',
		min: 0,
		nth: true,
		place: (flow, pos, _zoom, n) =>
			Object.fromEntries(Object.keys(pos).map((id) => [id, flow.formations[n - 1].pos[id]]))
	}
];

/** 選了 count 個人時，工具列和右鍵選單上有的項目（照順序）。沒選人（0）時是套用全隊的項目，只在右鍵選單上。 */
export function selectionActions(count: number): SelectionAction[] {
	return ACTIONS.filter((a) => count >= a.min);
}
