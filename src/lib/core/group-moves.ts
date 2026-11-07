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
