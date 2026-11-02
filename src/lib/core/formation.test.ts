import { describe, expect, it } from 'vitest';
import {
	addMembers,
	addSegment,
	createFlow,
	deleteFormation,
	formationAt,
	formationTimes,
	insertFormation,
	positionsAt,
	setPositions,
	updateSegment,
	type CommandResult,
	type Flow
} from './index';

function okFlow(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

/** 9 條直放，兩個隊員。 */
function twoMembers(): Flow {
	const flow = okFlow(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	const m = { name: '小A', gender: 'F', globalRole: 'top' } as const;
	return okFlow(addMembers(flow, [m, { ...m, name: '小B' }]));
}

describe('改位置', () => {
	it('位置存公尺，存真正的值，不四捨五入', () => {
		const flow = twoMembers();
		const [a] = flow.members;
		const after = okFlow(setPositions(flow, 'f1', { [a.id]: [1.2345678, -2.3456789] }));
		expect(after.formations[0].pos[a.id]).toEqual([1.2345678, -2.3456789]);
	});

	it('一次改好幾個人；沒改到的人不動', () => {
		const flow = twoMembers();
		const [a, b] = flow.members;
		const after = okFlow(setPositions(flow, 'f1', { [a.id]: [0, 0] }));
		expect(after.formations[0].pos[b.id]).toEqual(flow.formations[0].pos[b.id]);
		const both = okFlow(setPositions(flow, 'f1', { [a.id]: [1, 1], [b.id]: [2, 2] }));
		expect(both.formations[0].pos).toEqual({ [a.id]: [1, 1], [b.id]: [2, 2] });
	});

	it('可以站到墊子外 1 m，再外面就擋下', () => {
		const flow = twoMembers();
		const [a] = flow.members;
		// 9 條直放：外圍 x -9.23–9.23、y -7.40–7.40。
		expect(setPositions(flow, 'f1', { [a.id]: [-9.2, 7.39] }).kind).toBe('ok');
		expect(setPositions(flow, 'f1', { [a.id]: [-9.3, 0] })).toEqual({
			kind: 'blocked',
			message: '只能站到墊子外 1 m 以內'
		});
		expect(setPositions(flow, 'f1', { [a.id]: [0, 7.5] }).kind).toBe('blocked');
	});

	it('找不到站位或隊員就擋下', () => {
		const flow = twoMembers();
		expect(setPositions(flow, 'nope', { [flow.members[0].id]: [0, 0] }).kind).toBe('blocked');
		expect(setPositions(flow, 'f1', { nobody: [0, 0] }).kind).toBe('blocked');
	});

	it('新人被拖走後，原本等待的位置空出來給下一個新人', () => {
		const flow = twoMembers();
		const [a] = flow.members;
		const waiting = flow.formations[0].pos[a.id];
		const moved = okFlow(setPositions(flow, 'f1', { [a.id]: [0, 0] }));
		const next = okFlow(addMembers(moved, [{ name: '小C', gender: 'M', globalRole: 'base' }]));
		expect(next.formations[0].pos[next.members[2].id]).toEqual(waiting);
	});
});

describe('開頭站位', () => {
	it('新流程還沒有段時，開頭站位不指到段；加第一段後指到第一段的時間 0，之後加段不變', () => {
		let flow = twoMembers();
		expect(flow.formations[0]).toMatchObject({ id: 'f1', segmentId: null, at: 0 });
		flow = okFlow(addSegment(flow, 'chant'));
		expect(flow.formations[0]).toMatchObject({ id: 'f1', segmentId: 's1', at: 0 });
		flow = okFlow(addSegment(flow, 'music'));
		expect(flow.formations[0]).toMatchObject({ segmentId: 's1', at: 0 });
	});

	it('沒有段時不能插站位', () => {
		expect(insertFormation(twoMembers(), 0)).toEqual({ kind: 'blocked', message: '請先加一段' });
	});

	it('沒有段時，場上每一刻都是開頭站位的位置', () => {
		const flow = twoMembers();
		expect(positionsAt(flow, 0)).toEqual(flow.formations[0].pos);
		expect(formationAt(flow, 0)?.id).toBe('f1');
	});
});

/** 兩個隊員；音樂 1（150 BPM，一個半拍 0.2 秒，25.6 秒）→ 口號 1（10 秒）。 */
function withSegments(): Flow {
	let flow = twoMembers();
	flow = okFlow(addSegment(flow, 'music'));
	return okFlow(addSegment(flow, 'chant'));
}

const A = 'm1';
const B = 'm2';

/**
 * 小A 從開頭 [0, 0] 走到 20 秒（音樂 1 第 100 個半拍）的 [4, 0]，
 * 再跨段走到 30 秒（口號 1 第 44 個 0.1 秒）的 [4, 5]。小B 一直站在 [-2, 0]。
 */
function walking(): Flow {
	let flow = withSegments();
	flow = okFlow(setPositions(flow, 'f1', { [A]: [0, 0], [B]: [-2, 0] }));
	flow = okFlow(insertFormation(flow, 20));
	flow = okFlow(setPositions(flow, 'f2', { [A]: [4, 0] }));
	flow = okFlow(insertFormation(flow, 30));
	return okFlow(setPositions(flow, 'f3', { [A]: [4, 5] }));
}

function expectAt(flow: Flow, sec: number, id: string, [x, y]: [number, number]) {
	const [px, py] = positionsAt(flow, sec)[id];
	expect(px).toBeCloseTo(x, 9);
	expect(py).toBeCloseTo(y, 9);
}

describe('走位', () => {
	it('兩張站位之間每人走直線、速度不變', () => {
		const flow = walking();
		expectAt(flow, 0, A, [0, 0]);
		expectAt(flow, 5, A, [1, 0]);
		expectAt(flow, 10, A, [2, 0]);
		expectAt(flow, 20, A, [4, 0]);
		expectAt(flow, 10, B, [-2, 0]);
	});

	it('可以跨段：音樂 1 走到口號 1', () => {
		const flow = walking();
		expectAt(flow, 25, A, [4, 2.5]);
		expectAt(flow, 26, A, [4, 3]);
	});

	it('最後一張之後站著不動', () => {
		const flow = walking();
		expectAt(flow, 30, A, [4, 5]);
		expectAt(flow, 35.6, A, [4, 5]);
		expectAt(flow, 999, A, [4, 5]);
	});

	it('改 BPM 後站位還在同一拍，秒數跟著變', () => {
		const flow = okFlow(updateSegment(walking(), 's1', { bpm: 120 }));
		// 120 BPM：第 100 個半拍在 25 秒
		expectAt(flow, 25, A, [4, 0]);
		expectAt(flow, 12.5, A, [2, 0]);
	});
});

describe('刪站位', () => {
	it('刪掉中間那張，走位改成從前一張直接走到後一張', () => {
		const flow = okFlow(deleteFormation(walking(), 'f2'));
		expect(flow.formations.map((f) => f.id)).toEqual(['f1', 'f3']);
		expectAt(flow, 15, A, [2, 2.5]);
	});

	it('開頭那張刪不掉', () => {
		expect(deleteFormation(walking(), 'f1')).toEqual({
			kind: 'blocked',
			message: '流程開頭一定有一張站位，不能刪'
		});
	});

	it('找不到站位就擋下', () => {
		expect(deleteFormation(walking(), 'nope').kind).toBe('blocked');
	});
});

describe('站位的時間', () => {
	it('每張站位的全域秒數，照時間排（給站位縮圖列用）', () => {
		const times = formationTimes(walking()).map(({ formation, sec }) => [formation.id, sec]);
		expect(times).toEqual([
			['f1', 0],
			['f2', expect.closeTo(20, 9)],
			['f3', expect.closeTo(30, 9)]
		]);
	});
});

describe('插站位', () => {
	it('插在播放頭所在的那個半拍；播放頭在那個半拍裡就算在這張站位上', () => {
		const flow = okFlow(insertFormation(withSegments(), 8.25));
		expect(flow.formations.map((f) => [f.id, f.segmentId, f.at])).toEqual([
			['f1', 's1', 0],
			['f2', 's1', 41]
		]);
		expect(formationAt(flow, 8.2)?.id).toBe('f2');
		expect(formationAt(flow, 8.39)?.id).toBe('f2');
		expect(formationAt(flow, 8.4)).toBeUndefined();
		expect(formationAt(flow, 8.19)).toBeUndefined();
		expect(formationAt(flow, 0.1)?.id).toBe('f1');
	});

	it('口號段插到 0.1 秒', () => {
		const flow = okFlow(insertFormation(withSegments(), 25.6 + 3.27));
		expect(flow.formations[1]).toMatchObject({ segmentId: 's2', at: 32 });
	});

	it('照時間排，id 不重複', () => {
		let flow = okFlow(insertFormation(withSegments(), 20));
		flow = okFlow(insertFormation(flow, 5));
		expect(flow.formations.map((f) => [f.id, f.at])).toEqual([
			['f1', 0],
			['f3', 25],
			['f2', 100]
		]);
	});

	it('插的站位帶入那一刻大家走到的位置，所以其他人的走法不變', () => {
		const before = walking();
		const samples = [0, 2.5, 5, 7.5, 12.3, 20, 23, 30, 40];
		const inserted = okFlow(insertFormation(before, 5));
		const f = inserted.formations[1];
		expect(f.pos[A]).toEqual([1, 0]);
		const moved = okFlow(setPositions(inserted, f.id, { [B]: [-3, 3] }));
		for (const t of samples) {
			expect(positionsAt(moved, t)[A][0]).toBeCloseTo(positionsAt(before, t)[A][0], 9);
			expect(positionsAt(moved, t)[A][1]).toBeCloseTo(positionsAt(before, t)[A][1], 9);
		}
		expect(positionsAt(moved, 5)[B]).toEqual([-3, 3]);
	});

	it('那一拍已經有站位就擋下', () => {
		const flow = okFlow(insertFormation(withSegments(), 8.2));
		expect(insertFormation(flow, 8.3)).toEqual({ kind: 'blocked', message: '這一拍已經有站位' });
		expect(insertFormation(flow, 0.1).kind).toBe('blocked');
	});
});
