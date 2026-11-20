// 別人的改動（#253，ADR 0010、0014）：伺服器收了一步，用「比對前後」（diff.ts）找出改到的東西，
// 把改好之後的那些東西（新的樣子；刪掉的是 null）送給房間裡的其他人，不轉送指令。他們用 applyRemoteChange 套在自己的畫面上。
// 段、隊員、站位這些清單加了、刪了、調了順序時，另外帶伺服器上那份清單的 id 順序（比對前後只說「調了順序」，加在哪裡看不出來）。
// 書籤不帶順序：畫面照 A 的時間排，存的先後沒有意思；新的放在最後。

import type { Action } from './action-types';
import type { Bookmark } from './bookmarks';
import { diffFlows } from './diff';
import type { Flow } from './flow';
import type { Formation, Position, Walk } from './formation';

/** 有 id 的清單。 */
const LISTS = ['segments', 'members', 'formations', 'customRoles', 'audio', 'actions'] as const;
type ListName = (typeof LISTS)[number];

/** 東西的鍵開頭 → 它在哪個清單。 */
const LIST_OF: Record<string, ListName> = {
	segment: 'segments',
	member: 'members',
	formation: 'formations',
	role: 'customRoles',
	audio: 'audio',
	action: 'actions'
};

/**
 * 一步改好之後的樣子：things 是改到的東西（鍵同 diffFlows；after 是新的樣子，刪掉的是 null；動作不含紀錄），
 * orders 是 id 有變（加、刪、調順序）的清單在伺服器上的 id 順序。可以直接 JSON 送。
 */
export interface RemoteChange {
	things: { key: string; after: unknown }[];
	orders: Partial<Record<ListName, string[]>>;
}

/** 從改之前、改之後算出要送給別人的改動。 */
export function remoteChange(before: Flow, after: Flow): RemoteChange {
	const things = diffFlows(before, after)
		.filter((c) => c.key !== 'segmentOrder' && c.key !== 'memberOrder')
		// 標記沒設過就是號碼：送真正的值，套上去才跟伺服器一模一樣
		.map((c) => ({ key: c.key, after: c.key === 'markers' ? (after.markers ?? null) : c.after }));
	const orders: RemoteChange['orders'] = {};
	for (const list of LISTS) {
		const a = before[list].map((x) => x.id);
		const b = after[list].map((x) => x.id);
		if (a.length !== b.length || a.some((id, i) => id !== b[i])) orders[list] = b;
	}
	return { things, orders };
}

/**
 * 把別人的改動套在我這邊的流程上：改到的換成新的樣子、刪掉的拿掉，其他的保持我這邊的樣子。
 * 動作的紀錄留我這邊的（改動裡沒有紀錄）。我這邊有、伺服器還不知道的（還沒送到的步加的）留著，放在我這邊它前一個的後面。
 */
export function applyRemoteChange(flow: Flow, change: RemoteChange): Flow {
	const next: Flow = { ...flow };
	const maps = Object.fromEntries(LISTS.map((list) => [list, new Map(flow[list].map((x) => [x.id, x]))])) as {
		[L in ListName]: Map<string, Flow[L][number]>;
	};
	const bookmarks = new Map((flow.bookmarks ?? []).map((b) => [b.id, b]));
	const deleted = new Set<string>();
	const positions: { formationId: string; memberId: string; after: { pos?: Position; walk?: Walk } | null }[] = [];

	for (const { key, after } of change.things) {
		if (key === 'markers') {
			if (after === null) delete next.markers;
			else next.markers = after as Flow['markers'];
			continue;
		}
		if (key === 'name' || key === 'field' || key === 'timeRules') {
			(next as unknown as Record<string, unknown>)[key] = after;
			continue;
		}
		const [kind, id, memberId] = key.split(':');
		if (kind === 'bookmark') {
			if (after === null) bookmarks.delete(id);
			else bookmarks.set(id, after as Bookmark);
			continue;
		}
		if (kind === 'pos') {
			positions.push({ formationId: id, memberId, after: after as { pos?: Position; walk?: Walk } | null });
			continue;
		}
		const list = LIST_OF[kind];
		if (!list) continue;
		const map = maps[list] as Map<string, unknown>;
		if (after === null) {
			map.delete(id);
			deleted.add(id);
		} else if (list === 'actions') {
			map.set(id, withRecords(after as Action, maps.actions.get(id)));
		} else if (list === 'formations') {
			const { segmentId, at, name } = after as Pick<Formation, 'segmentId' | 'at' | 'name'>;
			const local = maps.formations.get(id);
			const f: Formation = { ...(local ?? { pos: {} }), id, segmentId, at };
			if (name === undefined) delete f.name;
			else f.name = name;
			map.set(id, f);
		} else {
			map.set(id, after);
		}
	}

	// 站位裡的一個人：在站位本身換好之後才套（新的站位這時才有）
	for (const { formationId, memberId, after } of positions) {
		const local = maps.formations.get(formationId);
		if (!local) continue;
		const f: Formation = { ...local, pos: { ...local.pos } };
		if (local.walks) f.walks = { ...local.walks };
		if (after?.pos) f.pos[memberId] = after.pos;
		else delete f.pos[memberId];
		if (after?.walk) f.walks = { ...f.walks, [memberId]: after.walk };
		else if (f.walks) delete f.walks[memberId];
		maps.formations.set(formationId, f);
	}

	for (const list of LISTS) {
		const map = maps[list] as Map<string, unknown>;
		const order = change.orders[list];
		const ids = order ? merged(order, flow[list].map((x) => x.id), map, deleted) : [...map.keys()];
		(next as unknown as Record<string, unknown>)[list] = ids.map((id) => map.get(id));
	}
	// 本來沒有書籤欄位、也沒有加書籤：不多出欄位
	if (flow.bookmarks || bookmarks.size) next.bookmarks = [...bookmarks.values()];
	return next;
}

/** 別人改好的動作帶上我這邊的紀錄。 */
function withRecords(action: Action, local: Action | undefined): Action {
	if (!action.successRate) return action;
	return { ...action, successRate: { ...action.successRate, records: local?.successRate?.records ?? [] } } as Action;
}

/** 伺服器的順序，加上我這邊才有的（沒被刪掉），各放在我這邊它前一個的後面。 */
function merged(server: string[], local: string[], have: Map<string, unknown>, deleted: Set<string>): string[] {
	const ids = server.filter((id) => have.has(id));
	const known = new Set(server);
	local.forEach((id, i) => {
		if (known.has(id) || deleted.has(id) || !have.has(id)) return;
		const prev = local.slice(0, i).findLast((p) => ids.includes(p));
		ids.splice(prev === undefined ? 0 : ids.indexOf(prev) + 1, 0, id);
	});
	return ids;
}
