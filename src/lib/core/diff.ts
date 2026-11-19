// 比對前後：給「改之前」「改之後」兩份流程，回這一步改到哪些東西（ADR 0014 的「同一個東西」那張表）。
// 伺服器用它判斷要不要退回、送給別人改好的東西；雲端流程的復原堆疊也用它。

import type { Action } from './action-types';
import type { Flow } from './flow';

/**
 * 改到的一個東西。key 是固定的鍵：
 * `name`、`field`、`timeRules`、`markers`、`segmentOrder`、`memberOrder`，
 * 或 `action:<id>`、`segment:<id>`、`member:<id>`、`role:<id>`、`audio:<id>`、
 * `formation:<站位 id>`（時間和名稱）、`pos:<站位 id>:<隊員 id>`（位置＋走法）。
 * before／after 是那個東西改之前／之後的樣子（可以直接 JSON 送）；新增的 before 是 null，刪掉的 after 是 null。
 * 動作的樣子不含紀錄（紀錄不算東西）；段、名單的順序是 id 的清單。
 */
export interface ThingChange {
	key: string;
	before: unknown;
	after: unknown;
}

/** 這一步改到的東西；兩份一樣是空的。 */
export function diffFlows(before: Flow, after: Flow): ThingChange[] {
	const from = things(before);
	const to = things(after);
	const fieldChanged = !same(from.get('field'), to.get('field'));
	const changes: ThingChange[] = [];
	for (const key of new Set([...from.keys(), ...to.keys()])) {
		const a = from.get(key) ?? null;
		const b = to.get(key) ?? null;
		// 改場地會動到每張站位的每個人，就算吸完剛好在原地也算。
		const touched = fieldChanged && key.startsWith('pos:') && a !== null && b !== null;
		if (touched || !same(a, b)) changes.push({ key, before: a, after: b });
	}
	for (const [key, list] of [
		['segmentOrder', (f: Flow) => f.segments.map((s) => s.id)],
		['memberOrder', (f: Flow) => f.members.map((m) => m.id)]
	] as const) {
		const a = list(before);
		const b = list(after);
		if (reordered(a, b)) changes.push({ key, before: a, after: b });
	}
	return changes;
}

/** 流程裡每個東西：鍵 → 樣子。 */
function things(flow: Flow): Map<string, unknown> {
	const map = new Map<string, unknown>([
		['name', flow.name],
		['field', flow.field],
		['timeRules', flow.timeRules],
		['markers', flow.markers ?? 'number']
	]);
	for (const s of flow.segments) map.set(`segment:${s.id}`, s);
	for (const m of flow.members) map.set(`member:${m.id}`, m);
	for (const r of flow.customRoles) map.set(`role:${r.id}`, r);
	for (const a of flow.audio) map.set(`audio:${a.id}`, a);
	for (const a of flow.actions) map.set(`action:${a.id}`, withoutRecords(a));
	for (const f of flow.formations) {
		map.set(`formation:${f.id}`, {
			segmentId: f.segmentId,
			at: f.at,
			name: f.name
		});
		const people = new Set([...Object.keys(f.pos), ...Object.keys(f.walks ?? {})]);
		for (const id of people) map.set(`pos:${f.id}:${id}`, { pos: f.pos[id], walk: f.walks?.[id] });
	}
	return map;
}

function withoutRecords(action: Action): Action {
	if (!action.successRate) return action;
	const { records: _records, ...rest } = action.successRate;
	return { ...action, successRate: rest } as Action;
}

/** 兩邊都有的 id，前後順序不一樣（只加、刪不算）。 */
function reordered(before: string[], after: string[]): boolean {
	const a = before.filter((id) => after.includes(id));
	const b = after.filter((id) => before.includes(id));
	return a.some((id, i) => id !== b[i]);
}

/** 一樣的樣子：照值比，物件的鍵順序不管，值是 undefined 的鍵當成沒有。 */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
	const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
	const ka = keys(a);
	const kb = keys(b);
	return (
		ka.length === kb.length &&
		ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
	);
}
