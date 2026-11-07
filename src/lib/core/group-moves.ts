// 一組人一起移到新位置的算法（選人工具列用）：拿選到的人現在的位置，算出新位置。
// 只算位置；插站位、往後帶、復原交給 moveGroup（formation.ts），跟拖人同一條路。

import type { FieldConfig } from './field';
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
 * 平均分開：照左右或前後（哪個方向攤得比較開就照哪個）的順序排，兩端的人不動，
 * 中間的人照順序排在兩端的連線上、間隔一樣，再吸附。
 */
export function spreadEvenly(
	field: FieldConfig,
	pos: Record<string, Position>,
	zoom: number
): Record<string, Position> {
	const all = Object.values(pos);
	const span = (i: 0 | 1) => Math.max(...all.map((p) => p[i])) - Math.min(...all.map((p) => p[i]));
	const axis = span(1) > span(0) ? 1 : 0;
	const order = Object.entries(pos).sort((a, b) => a[1][axis] - b[1][axis]);
	const [first, last] = [order[0][1], order[order.length - 1][1]];
	const n = order.length - 1;
	return Object.fromEntries(
		order.map(([id, p], i) => {
			if (i === 0 || i === n) return [id, p];
			const t = i / n;
			const at: Position = [first[0] + (last[0] - first[0]) * t, first[1] + (last[1] - first[1]) * t];
			return [id, snapPosition(field, at, zoom)];
		})
	);
}
