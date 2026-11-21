// 雲端流程復原、重做時清單怎麼排（#256，ADR 0014）：清單順序只動那一步加的、刪的、調了位置的，
// 其他照現在畫面上的（別人後來加的、調的不動）。
// 管：一步復原、重做要送的改動裡的清單順序（travelChange、travelOrder）。
// 不管：改動怎麼算、怎麼套上去、站位照時間排（cloud-undo.ts）；復原堆疊、記下復原前畫面上的順序（編輯 session）。

import type { UndoChanges } from './cloud-undo';
import type { Flow } from './flow';
import type { RemoteChange } from './remote-change';

type ListName = keyof RemoteChange['orders'];

/** 清單的 id 順序。 */
const idsOf = (flow: Flow, list: string) => (flow[list as ListName] as { id: string }[]).map((x) => x.id);

/**
 * 雲端流程復原、重做要送的改動：清單順序只動這一步加的、刪的、調了位置的（比復原、重做兩邊的順序），
 * 其他照現在畫面上的（別人後來加的、調的不動）；動到的放在 anchor 裡它前一個的後面。
 */
export function travelChange(flow: Flow, changes: UndoChanges, redo: boolean, anchor: RemoteChange['orders']): RemoteChange {
	const to = redo ? changes.redo : changes.undo;
	const orders = Object.entries(to.orders).map(([list, wanted]) => {
		const order = travelOrder(
			{
				before: changes.undo.orders[list as ListName] ?? [],
				after: changes.redo.orders[list as ListName] ?? [],
				now: idsOf(flow, list),
				anchor: anchor[list as ListName] ?? wanted
			},
			redo
		);
		return [list, order];
	});
	return { ...to, orders: Object.fromEntries(orders) };
}

/**
 * 一個清單復原（redo 是重做）之後的順序。before、after：那一步改之前、改之後的順序；now：現在畫面上的；
 * anchor：動到的放在這裡它前一個的後面。
 */
export function travelOrder(
	{ before, after, now, anchor }: { before: string[]; after: string[]; now: string[]; anchor: string[] },
	redo: boolean
): string[] {
	const [was, wanted] = redo ? [before, after] : [after, before];
	const gone = new Set(was.filter((id) => !wanted.includes(id)));
	// 調了位置的兩個方向算同一組（復原、重做都比「改之前 → 改之後」），重做才放得回復原拿走的那幾個。
	// 整份比才認得出是誰被調（A B C → B C A 是 A）；一樣長的同順序，挑現在還在的多的（調走的那個後來被刪了，
	// 就算它被調），再拿掉現在不在的
	const here = new Set(now);
	const shifted = moved(before, after, here).filter((id) => here.has(id));
	const moving = new Set([...wanted.filter((id) => !was.includes(id)), ...shifted]);
	const ids = now.filter((id) => !gone.has(id) && !moving.has(id));
	for (const id of anchor) {
		if (!moving.has(id)) continue;
		const prev = anchor.slice(0, anchor.indexOf(id)).findLast((p) => ids.includes(p));
		ids.splice(prev === undefined ? 0 : ids.indexOf(prev) + 1, 0, id);
	}
	return ids;
}

/**
 * b 比 a 調了位置的：兩邊都有的裡面，最長的一串同順序以外的；一樣長的挑 here 裡的多的。
 * 兩邊都有的 id 各只一次，最長的同順序就是 b 在 a 裡的位置最長的遞增串；每個 id 算 n + 1 分、在 here 裡多 1 分，
 * 挑分數最多的遞增串（樹狀陣列查前面最多的，n log n、記憶體 n，幾千張站位也撐得住）。
 */
function moved(a: string[], b: string[], here: Set<string>): string[] {
	const at = new Map(a.map((id, i) => [id, i]));
	const y = b.filter((id) => at.has(id));
	const best: { score: number; j: number }[] = Array.from({ length: a.length + 1 }, () => ({ score: 0, j: -1 }));
	const prev = new Array<number>(y.length).fill(-1);
	let top = { score: 0, j: -1 };
	y.forEach((id, j) => {
		const v = at.get(id)! + 1;
		let before = { score: 0, j: -1 };
		for (let k = v - 1; k > 0; k -= k & -k) if (best[k].score > before.score) before = best[k];
		prev[j] = before.j;
		const mine = { score: before.score + y.length + 1 + (here.has(id) ? 1 : 0), j };
		for (let k = v; k < best.length; k += k & -k) if (mine.score > best[k].score) best[k] = mine;
		if (mine.score > top.score) top = mine;
	});
	const kept = new Set<string>();
	for (let j = top.j; j >= 0; j = prev[j]) kept.add(y[j]);
	return y.filter((id) => !kept.has(id));
}
