// 一組人一起移到新位置的算法（選人工具列用）：拿選到的人現在的位置，算出新位置。
// 只算位置；插站位、往後帶、復原交給 moveGroup（formation.ts），跟拖人同一條路。

import { POS_EPS, type FieldConfig } from './field';
import type { Position } from './formation';
import { snapPosition } from './snap';

/** 小於這個（公尺）就算站在中線上。 */
const ON_LINE_M = 1e-6;

/**
 * 鏡像：以場地的左右中線（x = 0，直放、橫放都一樣）為軸，左右對調，前後不變，再把左右吸到吸附點
 * （吸附點左右對稱，本來在吸附點上的人翻過去還是在吸附點上）。站在中線上的人不動。
 */
export function mirrorPositions(
	field: FieldConfig,
	pos: Record<string, Position>,
	zoom: number
): Record<string, Position> {
	return Object.fromEntries(
		Object.entries(pos).map(([id, [x, y]]) => [
			id,
			Math.abs(x) < ON_LINE_M ? [x, y] : [snapPosition(field, [-x, y], zoom)[0], y]
		])
	);
}

/** 對齊成一橫排：前後位置都改成大家的平均（吸附），左右不變。 */
export function alignRow(field: FieldConfig, pos: Record<string, Position>, zoom: number): Record<string, Position> {
	return alignAxis(field, pos, zoom, 1);
}

/** 對齊成一直排：左右位置都改成大家的平均（吸附），前後不變。 */
export function alignColumn(field: FieldConfig, pos: Record<string, Position>, zoom: number): Record<string, Position> {
	return alignAxis(field, pos, zoom, 0);
}

function alignAxis(
	field: FieldConfig,
	pos: Record<string, Position>,
	zoom: number,
	axis: 0 | 1
): Record<string, Position> {
	const all = Object.values(pos);
	const mean = all.reduce((s, p) => s + p[axis], 0) / all.length;
	const v = snapPosition(field, [mean, mean], zoom)[axis];
	return Object.fromEntries(
		Object.entries(pos).map(([id, p]) => [id, (axis === 0 ? [v, p[1]] : [p[0], v]) as Position])
	);
}

/**
 * 平均分開：距離最遠的兩個人當兩端，不動；中間的人照在兩端連線上的先後排，間隔一樣，再吸附。
 * 比距離、比先後都有容差（POS_EPS），比不出來再看離連線的左右、再看 id：
 * 結果跟選的順序、浮點數誤差都無關（L 形時不會由誤差決定誰是兩端）。
 */
export function spreadEvenly(
	field: FieldConfig,
	pos: Record<string, Position>,
	zoom: number
): Record<string, Position> {
	const people = Object.entries(pos).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const dist = (p: Position, q: Position) => Math.hypot(p[0] - q[0], p[1] - q[1]);
	const pairs = people.flatMap(([, p], i) => people.slice(i + 1).map(([, q], k) => ({ i, j: i + 1 + k, d: dist(p, q) })));
	const far = Math.max(...pairs.map((pair) => pair.d));
	const ends = pairs.find((pair) => pair.d >= far - POS_EPS)!;
	const [first, last] = [people[ends.i][1], people[ends.j][1]];
	const u = [last[0] - first[0], last[1] - first[1]];
	// 沿著連線多遠、離連線多遠（都乘了 far，所以容差也乘 far）
	const along = (p: Position) => (p[0] - first[0]) * u[0] + (p[1] - first[1]) * u[1];
	const across = (p: Position) => (p[1] - first[1]) * u[0] - (p[0] - first[0]) * u[1];
	const tol = POS_EPS * far;
	const middle = people
		.filter((_, k) => k !== ends.i && k !== ends.j)
		.sort(([, p], [, q]) => {
			const a = along(p) - along(q);
			if (Math.abs(a) > tol) return a;
			const b = across(p) - across(q);
			return Math.abs(b) > tol ? b : 0; // 還是一樣：照 id（people 已經照 id 排好，sort 不換順序）
		});
	const n = middle.length + 1;
	return Object.fromEntries([
		people[ends.i],
		...middle.map(([id], k): [string, Position] => {
			const t = (k + 1) / n;
			return [id, snapPosition(field, [first[0] + u[0] * t, first[1] + u[1] * t], zoom)];
		}),
		people[ends.j]
	]);
}
