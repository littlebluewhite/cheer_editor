// 站位：全隊在某一刻的位置。每張都包含全隊每一個人。
// 時間欄位（segmentId、at）由做站位與走位的票補上；現在只有開頭那張。

import { fieldGeometry } from './field';
import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';

/** 公尺座標 [x, y]，方向見 docs/flow-file-format.md 的「位置座標」。存真正的值，不四捨五入。 */
export type Position = [number, number];

export interface Formation {
	id: string;
	/** 隊員 id → 位置。 */
	pos: Record<string, Position>;
}

/** 改一張站位裡一個或多個隊員的位置。位置可以在墊子外 1 m 以內。 */
export function setPositions(
	flow: Flow,
	formationId: string,
	moves: Record<string, Position>
): CommandResult {
	const formation = flow.formations.find((f) => f.id === formationId);
	if (!formation) return blocked('找不到這張站位');
	const { outer } = fieldGeometry(flow.field);
	const eps = 1e-9;
	for (const [id, [x, y]] of Object.entries(moves)) {
		if (!flow.members.some((m) => m.id === id)) return blocked('找不到這個隊員');
		const inside =
			x >= outer.x - eps &&
			x <= outer.x + outer.width + eps &&
			y >= outer.y - eps &&
			y <= outer.y + outer.height + eps;
		if (!inside) return blocked('只能站到墊子外 1 m 以內');
	}
	const updated = { ...formation, pos: { ...formation.pos, ...moves } };
	return ok({ ...flow, formations: flow.formations.map((f) => (f === formation ? updated : f)) });
}
