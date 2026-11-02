import { describe, expect, it } from 'vitest';
import {
	addMembers,
	addSegment,
	createFlow,
	deleteFormation,
	formationAt,
	formationTimes,
	insertFormation,
	moveMembers,
	moveTargetText,
	positionsAt,
	setPositions,
	updateSegment,
	type CommandResult,
	type Flow,
	type Walk
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
	it('沒設的人先站著，最後一個八拍才走：直線、速度不變', () => {
		const flow = walking();
		// 150 BPM：一個八拍 3.2 秒，所以 16.8 秒出發、20 秒到。
		expectAt(flow, 0, A, [0, 0]);
		expectAt(flow, 10, A, [0, 0]);
		expectAt(flow, 16.8, A, [0, 0]);
		expectAt(flow, 17.6, A, [1, 0]);
		expectAt(flow, 18.4, A, [2, 0]);
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
		// 120 BPM：第 100 個半拍在 25 秒，一個八拍 4 秒，所以 21 秒出發
		expectAt(flow, 25, A, [4, 0]);
		expectAt(flow, 21, A, [0, 0]);
		expectAt(flow, 23, A, [2, 0]);
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

	it('哪幾張可以刪：開頭那張不行（縮圖不畫 ✕）', () => {
		expect(formationTimes(walking()).map((t) => t.deletable)).toEqual([false, true, true]);
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
		const samples = [0, 2.5, 5, 7.5, 12.3, 17, 18.4, 19.5, 20, 23, 30, 40];
		// 18.4 秒：小A 正在走（16.8 秒出發、20 秒到），走到一半
		const inserted = okFlow(insertFormation(before, 18.4));
		const f = inserted.formations[1];
		expect(f.pos[A][0]).toBeCloseTo(2, 9);
		const moved = okFlow(setPositions(inserted, f.id, { [B]: [-3, 3] }));
		for (const t of samples) {
			expect(positionsAt(moved, t)[A][0]).toBeCloseTo(positionsAt(before, t)[A][0], 9);
			expect(positionsAt(moved, t)[A][1]).toBeCloseTo(positionsAt(before, t)[A][1], 9);
		}
		expectAt(moved, 18.4, B, [-3, 3]);
	});

	it('那一拍已經有站位就擋下', () => {
		const flow = okFlow(insertFormation(withSegments(), 8.2));
		expect(insertFormation(flow, 8.3)).toEqual({ kind: 'blocked', message: '這一拍已經有站位' });
		expect(insertFormation(flow, 0.1).kind).toBe('blocked');
	});
});

describe('在播放頭拖人', () => {
	it('播放頭在站位上：改那張，不插新的；回傳那張的秒數', () => {
		const before = walking();
		const r = moveMembers(before, 20.1, { [B]: [1, 1] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.inserted).toBe(false);
		expect(r.sec).toBeCloseTo(20, 9);
		expect(r.flow.formations.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
		expect(r.flow.formations[1].pos[B]).toEqual([1, 1]);
	});

	it('播放頭不在站位上：在這一拍插一張（其他人帶入那一刻的位置）再改；回傳這一拍開始的秒數', () => {
		const r = moveMembers(walking(), 18.45, { [B]: [-3, 3] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.inserted).toBe(true);
		expect(r.sec).toBeCloseTo(18.4, 9);
		const f = r.flow.formations[1];
		expect(f.pos[A][0]).toBeCloseTo(2, 9);
		expect(f.pos[B]).toEqual([-3, 3]);
	});

	it('位置被擋就什麼都不改（也不插站位）', () => {
		expect(moveMembers(walking(), 5, { [B]: [0, 99] })).toEqual({
			kind: 'blocked',
			message: '只能站到墊子外 1 m 以內'
		});
	});
});

/** 在一張站位上幫一個人設出發和到達（還沒有設定指令，直接改資料）。 */
function withWalk(flow: Flow, formationId: string, id: string, walk: Walk): Flow {
	return {
		...flow,
		formations: flow.formations.map((f) =>
			f.id === formationId ? { ...f, walks: { ...f.walks, [id]: walk } } : f
		)
	};
}

/** 0 到 45 秒每 0.05 秒，再加上幾個交界旁邊的時間點，每個人的位置都一樣。 */
function expectSamePositions(before: Flow, after: Flow) {
	const samples = [
		...Array.from({ length: 901 }, (_, i) => i * 0.05),
		1e-7,
		16.8 - 1e-7,
		20 - 1e-7,
		25.6 + 1e-7
	];
	for (const t of samples) {
		const p = positionsAt(before, t);
		const q = positionsAt(after, t);
		for (const id of Object.keys(p)) {
			expect(q[id][0], `${id} @ ${t}`).toBeCloseTo(p[id][0], 9);
			expect(q[id][1], `${id} @ ${t}`).toBeCloseTo(p[id][1], 9);
		}
	}
}

/**
 * 口號 1（10 秒）→ 音樂 1（150 BPM）。小A 從 [0, 0] 走到 11.6 秒（音樂 1 第 8 個半拍）的 [4, 0]，
 * 預設 8.4 秒出發（在口號 1 裡）；小B 自己設口號 1 的 3 秒出發、音樂 1 第 4 個半拍（10.8 秒）到。
 */
function chantThenMusic(): Flow {
	let flow = twoMembers();
	flow = okFlow(addSegment(flow, 'chant'));
	flow = okFlow(addSegment(flow, 'music'));
	flow = okFlow(setPositions(flow, 'f1', { [A]: [0, 0], [B]: [1, 1] }));
	flow = okFlow(insertFormation(flow, 11.6));
	flow = okFlow(setPositions(flow, 'f2', { [A]: [4, 0], [B]: [1, -3] }));
	return withWalk(flow, 'f2', B, {
		depart: { segmentId: 's1', at: 30 },
		arrive: { segmentId: 's2', at: 4 }
	});
}

describe('走位的時間', () => {
	it('兩張站位的位置一樣：整段站著不動', () => {
		const flow = walking();
		for (const t of [0, 10, 18, 20, 25]) expectAt(flow, t, B, [-2, 0]);
	});

	it('兩張之間不到一個八拍：整段走', () => {
		let flow = withSegments();
		flow = okFlow(setPositions(flow, 'f1', { [A]: [0, 0] }));
		flow = okFlow(insertFormation(flow, 2));
		flow = okFlow(setPositions(flow, 'f2', { [A]: [4, 0] }));
		expectAt(flow, 0.5, A, [1, 0]);
		expectAt(flow, 1, A, [2, 0]);
	});

	it('後一張在口號段：整段走', () => {
		// 20 秒 → 30 秒（口號 1），整段 10 秒走 5 m
		expectAt(walking(), 21, A, [4, 0.5]);
	});

	it('出發落進前一段：用後一張那段的 BPM 往前 8 拍', () => {
		const flow = chantThenMusic();
		expectAt(flow, 8.4, A, [0, 0]);
		expectAt(flow, 10, A, [2, 0]);
		expectAt(flow, 11.6, A, [4, 0]);
	});

	it('出發落進前一段、不在那一段的格子上：往前取到那一段的 0.1 秒', () => {
		// 口號 1（10 秒）→ 音樂 1（140 BPM，一個半拍 3/14 秒）
		let flow = twoMembers();
		flow = okFlow(addSegment(flow, 'chant'));
		flow = okFlow(addSegment(flow, 'music'));
		flow = okFlow(updateSegment(flow, 's2', { bpm: 140 }));
		flow = okFlow(setPositions(flow, 'f1', { [A]: [0, 0] }));
		// 音樂 1 第 8 個半拍：10 + 12/7 ≈ 11.714 秒；往前 8 拍 ≈ 8.286 秒，取到 8.2 秒
		const arrive = 10 + 12 / 7;
		flow = okFlow(insertFormation(flow, arrive + 0.01));
		flow = okFlow(setPositions(flow, 'f2', { [A]: [4, 0] }));
		expectAt(flow, 8.2, A, [0, 0]);
		expectAt(flow, (8.2 + arrive) / 2, A, [2, 0]);
		expectAt(flow, arrive, A, [4, 0]);
	});

	it('自己設的：照設的出發和到達走，早到的人站著等', () => {
		// 4 秒（第 20 個半拍）出發，10 秒（第 50 個半拍）到
		const flow = withWalk(walking(), 'f2', A, {
			depart: { segmentId: 's1', at: 20 },
			arrive: { segmentId: 's1', at: 50 }
		});
		expectAt(flow, 4, A, [0, 0]);
		expectAt(flow, 7, A, [2, 0]);
		expectAt(flow, 10, A, [4, 0]);
		expectAt(flow, 15, A, [4, 0]);
	});

	it('自己設的可以跨段', () => {
		const flow = chantThenMusic();
		expectAt(flow, 3, B, [1, 1]);
		expectAt(flow, 6.9, B, [1, -1]);
		expectAt(flow, 10.8, B, [1, -3]);
	});

	it('自己設的時間超出兩張之間：夾回來', () => {
		// 到達設在口號 1 的 2 秒（27.6 秒），夾回 20 秒；出發 10 秒
		const flow = withWalk(walking(), 'f2', A, {
			depart: { segmentId: 's1', at: 50 },
			arrive: { segmentId: 's2', at: 20 }
		});
		expectAt(flow, 15, A, [2, 0]);
		expectAt(flow, 20, A, [4, 0]);
	});

	it('夾完出發不早於到達：當作沒設，用預設', () => {
		// 出發和到達都在 f2 之後，夾完都是 20 秒
		const flow = withWalk(walking(), 'f2', A, {
			depart: { segmentId: 's2', at: 10 },
			arrive: { segmentId: 's2', at: 20 }
		});
		expectAt(flow, 16.8, A, [0, 0]);
		expectAt(flow, 18.4, A, [2, 0]);
	});
});

describe('插站位時，每個人每一刻的位置都不變', () => {
	it('插在還沒出發的時候', () => {
		const before = walking();
		expectSamePositions(before, okFlow(insertFormation(before, 10)));
	});

	it('插在正在走的時候', () => {
		const before = walking();
		expectSamePositions(before, okFlow(insertFormation(before, 18.4)));
		expectSamePositions(before, okFlow(insertFormation(before, 19.8)));
	});

	it('插在口號段、跨段走到一半', () => {
		const before = walking();
		expectSamePositions(before, okFlow(insertFormation(before, 27.3)));
	});

	it('插在早到的人已經到之後、正在走、還沒出發', () => {
		const before = withWalk(walking(), 'f2', A, {
			depart: { segmentId: 's1', at: 20 },
			arrive: { segmentId: 's1', at: 50 }
		});
		for (const t of [2, 7, 12]) expectSamePositions(before, okFlow(insertFormation(before, t)));
	});

	it('跨段的走位，插在前一段和後一段', () => {
		const before = chantThenMusic();
		for (const t of [2, 3, 8.5, 9.95, 10, 10.4, 11, 11.4]) {
			expectSamePositions(before, okFlow(insertFormation(before, t)));
		}
	});

	it('插了之後再插（被切開的走位再切一次）', () => {
		const before = walking();
		let after = okFlow(insertFormation(before, 18));
		after = okFlow(insertFormation(after, 19.2));
		after = okFlow(insertFormation(after, 17.2));
		expectSamePositions(before, after);
	});

	it('沒有走位的人不寫出發和到達', () => {
		const after = okFlow(insertFormation(walking(), 18.4));
		for (const f of after.formations) expect(f.walks?.[B]).toBeUndefined();
	});
});

describe('往後帶', () => {
	it('後面還站在舊位置的站位一起改，回傳往後帶到幾張', () => {
		const r = moveMembers(walking(), 0, { [B]: [1, 1] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations.map((f) => f.pos[B])).toEqual([
			[1, 1],
			[1, 1],
			[1, 1]
		]);
		expect(r.carried).toBe(2);
	});

	it('遇到第一張他不在舊位置的就停，後面都不動', () => {
		let flow = okFlow(setPositions(walking(), 'f2', { [B]: [5, 5] }));
		flow = okFlow(setPositions(flow, 'f3', { [B]: [-2, 0] }));
		const r = moveMembers(flow, 0, { [B]: [1, 1] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations.map((f) => f.pos[B])).toEqual([
			[1, 1],
			[5, 5],
			[-2, 0]
		]);
		expect(r.carried).toBe(0);
	});

	it('舊位置容許 1e-9 誤差', () => {
		const flow = okFlow(setPositions(walking(), 'f2', { [B]: [-2 + 1e-10, 0] }));
		const r = moveMembers(flow, 0, { [B]: [1, 1] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations[1].pos[B]).toEqual([1, 1]);
		expect(r.carried).toBe(2);
	});

	it('好幾個人一起改：每人各自往後帶，N 是被改到的站位張數', () => {
		// 小A 在 f2 已經不在 [0, 0]，不往後帶；小B 帶到 f2、f3。
		const r = moveMembers(walking(), 0, { [A]: [1, 0], [B]: [1, 1] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations[1].pos[A]).toEqual([4, 0]);
		expect(r.flow.formations[2].pos[B]).toEqual([1, 1]);
		expect(r.carried).toBe(2);
	});

	it('插站位時也往後帶', () => {
		const r = moveMembers(walking(), 5.05, { [B]: [-3, 3] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.inserted).toBe(true);
		expect(r.flow.formations.map((f) => f.pos[B])).toEqual([
			[-2, 0],
			[-3, 3],
			[-3, 3],
			[-3, 3]
		]);
		expect(r.carried).toBe(2);
	});

	it('往後帶不動被改的那張前面的站位', () => {
		const r = moveMembers(walking(), 20, { [B]: [1, 1] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations.map((f) => f.pos[B])).toEqual([
			[-2, 0],
			[1, 1],
			[1, 1]
		]);
		expect(r.carried).toBe(1);
	});

	it('位置沒變（拖了又放回原處）不算往後帶', () => {
		const r = moveMembers(walking(), 0, { [B]: [-2, 0] });
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.carried).toBe(0);
	});
});

describe('拖人之前的那一行字', () => {
	it('在開頭那張：站位 1（開頭）', () => {
		expect(moveTargetText(walking(), 0.1)).toBe('拖人會改：站位 1（開頭）');
		expect(moveTargetText(twoMembers(), 0)).toBe('拖人會改：站位 1（開頭）');
	});

	it('在站位上：站位編號跟縮圖列一樣照時間排，拍子用八拍寫法；口號段寫秒數', () => {
		// f2 在音樂 1 第 100 個半拍（7-3），f3 在口號 1 4.4 秒。
		expect(moveTargetText(walking(), 20.1)).toBe('拖人會改：站位 2（7-3）');
		expect(moveTargetText(walking(), 30)).toBe('拖人會改：站位 3（4.4 秒）');
		// 後插的站位 id 比較大，但時間比較前，編號照時間。
		const flow = okFlow(insertFormation(walking(), 5));
		expect(moveTargetText(flow, 20)).toBe('拖人會改：站位 3（7-3）');
	});

	it('不在站位上：在這一拍插一張新站位', () => {
		expect(moveTargetText(walking(), 5.05)).toBe('拖人會在 2-5& 插一張新站位');
		expect(moveTargetText(walking(), 27.31)).toBe('拖人會在 1.7 秒 插一張新站位');
	});
});
