// 選人工具列和右鍵選單共用的「現在可以做的事」：兩邊都照這一份清單畫，項目一樣、做的事一樣。
// 每一項只給「選到的人的新位置怎麼算」；插站位、往後帶、一步復原都走 moveGroup（跟拖人同一條路，見 SelectionTools）。

import { alignColumn, alignRow, mirrorPositions, spreadEvenly, type Flow, type Position } from '#lib/core';
import { m } from '#lib/paraglide/messages.js';

export interface SelectionAction {
	/** 按鈕和選單上的字。 */
	label: string;
	/** 滑鼠停著時的說明。 */
	title: string;
	/** 至少選幾個人才出現。 */
	min: number;
	/** 收在同一個「名字 ▾」底下的一組（例：對齊）；沒有就自己一顆鈕。 */
	group?: string;
	/**
	 * 選到的人在這一拍的位置 → 新位置。zoom 是場地放大倍數（吸附用，跟拖人一樣）。
	 * n：有 nth 的項目才有，框裡打的第幾張站位（一定有那一張）。
	 */
	place: (flow: Flow, pos: Record<string, Position>, zoom: number, n: number) => Record<string, Position>;
	/** 有的話：label 裡的 [_] 是一個「第幾張站位」數字框（例：跟第 [_] 張一樣），框的值給 place 的 n。 */
	nth?: true;
}

/** 全部的項目：字照畫面的語言（每次叫的時候寫）。 */
const actions = (): SelectionAction[] => [
	{
		label: m.session_mirror(),
		title: m.session_mirror_title(),
		min: 1,
		place: (flow, pos, zoom) => mirrorPositions(flow.field, pos, zoom)
	},
	{
		label: m.session_same_as(),
		title: m.session_same_as_title(),
		min: 0,
		nth: true,
		place: (flow, pos, _zoom, n) =>
			Object.fromEntries(Object.keys(pos).map((id) => [id, flow.formations[n - 1].pos[id]]))
	},
	{
		label: m.session_row(),
		title: m.session_row_title(),
		min: 2,
		group: m.session_align(),
		place: (flow, pos, zoom) => alignRow(flow.field, pos, zoom)
	},
	{
		label: m.session_column(),
		title: m.session_column_title(),
		min: 2,
		group: m.session_align(),
		place: (flow, pos, zoom) => alignColumn(flow.field, pos, zoom)
	},
	{
		label: m.session_spread(),
		title: m.session_spread_title(),
		min: 3,
		place: (flow, pos, zoom) => spreadEvenly(flow.field, pos, zoom)
	}
];

/** 選了 count 個人時，工具列和右鍵選單上有的項目（照順序）。沒選人（0）時是套用全隊的項目。 */
export function selectionActions(count: number): SelectionAction[] {
	return actions().filter((a) => count >= a.min);
}
