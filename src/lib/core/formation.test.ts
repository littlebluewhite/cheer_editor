import { describe, expect, it } from 'vitest';
import {
	TOO_FAST_MPS,
	TIRING_MPS,
	addAction,
	addMembers,
	addSegment,
	clearWalks,
	createFlow,
	currentFormation,
	deleteFormation,
	formationAt,
	formationTimes,
	formationWalks,
	insertFormation,
	matchPrevious,
	memberWalk,
	moveFormation,
	moveFormationHint,
	moveGroup,
	moveMembers,
	moveTargetText,
	positionsAt,
	renameFormation,
	setPositions,
	setTeamWalks,
	setWalks,
	updateSegment,
	walkSpanAt,
	walkSpeedText,
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
			message: '只能站到場地外 1 公尺以內'
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
		const moved = okFlow(setPositions(flow, 'f1', { [a.id]: [3, 3] }));
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

describe('站位名稱', () => {
	it('取名字：存去頭尾空白的名字，其他不動', () => {
		const flow = okFlow(renameFormation(walking(), 'f2', '  高低兩排 '));
		expect(flow.formations[1].name).toBe('高低兩排');
		expect({ ...flow.formations[1], name: undefined }).toEqual({ ...walking().formations[1], name: undefined });
	});

	it('清成空白：拿掉名字，只顯示號碼', () => {
		const named = okFlow(renameFormation(walking(), 'f1', '開場'));
		const flow = okFlow(renameFormation(named, 'f1', '   '));
		expect('name' in flow.formations[0]).toBe(false);
	});

	it('名稱最多 20 個字，超過就擋下', () => {
		expect(okFlow(renameFormation(walking(), 'f2', '字'.repeat(20))).formations[1].name).toBe('字'.repeat(20));
		expect(renameFormation(walking(), 'f2', '字'.repeat(21))).toEqual({ kind: 'blocked', message: '站位名稱最多 20 個字' });
	});

	it('找不到站位：擋下', () => {
		expect(renameFormation(walking(), 'nope', 'x').kind).toBe('blocked');
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
			message: '只能站到場地外 1 公尺以內'
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

	it('後一張在口號段開頭、前一段是音樂段：用前一段的 BPM 往前 8 拍出發，不從前一張整段走（#221）', () => {
		// 開頭 → 25.6 秒（口號 1 的 0 秒）：前一段音樂 1 是 150 BPM，往前 8 拍是 22.4 秒
		let flow = withSegments();
		flow = okFlow(setPositions(flow, 'f1', { [A]: [0, 0] }));
		flow = okFlow(insertFormation(flow, 25.6));
		flow = okFlow(setPositions(flow, 'f2', { [A]: [4, 0] }));
		expect(flow.formations[1]).toMatchObject({ segmentId: 's2', at: 0 });
		expectAt(flow, 22.4, A, [0, 0]);
		expectAt(flow, 24, A, [2, 0]);
		expect(memberWalk(flow, 'f2', A)).toEqual({ depart: at('s1', 112), arrive: at('s2', 0) });
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

	it('前一段改短後，出發落到後一段的格子之間：插了也不挪', () => {
		let before = twoMembers();
		before = okFlow(addSegment(before, 'chant'));
		before = okFlow(addSegment(before, 'music'));
		before = okFlow(updateSegment(before, 's2', { bpm: 140 }));
		before = okFlow(setPositions(before, 'f1', { [A]: [0, 0], [B]: [0, 0] }));
		// f2 在音樂段第 80 個半拍
		before = okFlow(insertFormation(before, 10 + (80 * 60) / 140 / 2));
		before = okFlow(setPositions(before, 'f2', { [B]: [4, 0] }));
		before = withWalk(before, 'f2', B, {
			depart: { segmentId: 's1', at: 90 },
			arrive: { segmentId: 's2', at: 40 }
		});
		// 口號段改成 5 秒：出發還記第 90 個 0.1 秒（9 秒），在音樂段的兩個半拍之間
		before = okFlow(updateSegment(before, 's1', { seconds: 5 }));
		expectSamePositions(before, okFlow(insertFormation(before, 15)));
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

describe('現在的站位', () => {
	// walking()：f1 開頭 → f2 在 20 秒 → f3 在 30 秒。

	it('播放頭在哪張之後、下一張之前，就是那張；編號照時間排', () => {
		const flow = walking();
		expect(currentFormation(flow, 0)).toMatchObject({ formation: { id: 'f1' }, number: 1 });
		expect(currentFormation(flow, 19.9)).toMatchObject({ formation: { id: 'f1' }, number: 1 });
		expect(currentFormation(flow, 20)).toMatchObject({ formation: { id: 'f2' }, number: 2 });
		expect(currentFormation(flow, 25)).toMatchObject({ formation: { id: 'f2' }, number: 2 });
		expect(currentFormation(flow, 99)).toMatchObject({ formation: { id: 'f3' }, number: 3 });
	});

	it('還沒有段：開頭那張', () => {
		expect(currentFormation(twoMembers(), 0)).toMatchObject({ formation: { id: 'f1' }, number: 1 });
	});
});

describe('走位那一段', () => {
	// walking()：f1 開頭 → f2 在 20 秒（音樂 1 第 100 個半拍）→ f3 在 30 秒（口號 1 第 44 個 0.1 秒）。
	/** 播放頭在 sec 時是哪兩張之間的走位：[前一張, 走到的那張, 是不是停在走到的那張上]。 */
	const span = (flow: Flow, sec: number) => {
		const s = walkSpanAt(flow, sec);
		return s && [s.from.id, s.to.id, s.on];
	};

	it('在一張站位上（那一拍裡都算）：前一張走到這一張', () => {
		expect(span(walking(), 20)).toEqual(['f1', 'f2', true]);
		expect(span(walking(), 20.1)).toEqual(['f1', 'f2', true]);
		expect(span(walking(), 30)).toEqual(['f2', 'f3', true]);
	});

	it('在兩張中間：前後這兩張，不在站位上', () => {
		expect(span(walking(), 10)).toEqual(['f1', 'f2', false]);
		expect(span(walking(), 19.9)).toEqual(['f1', 'f2', false]);
		expect(span(walking(), 25)).toEqual(['f2', 'f3', false]);
	});

	it('在開頭那張上：前面沒有走位', () => {
		expect(span(walking(), 0)).toBeNull();
		expect(span(walking(), 0.1)).toBeNull();
	});

	it('在最後一張之後：後面沒有走位', () => {
		expect(span(walking(), 31)).toBeNull();
		expect(span(walking(), 999)).toBeNull();
	});

	it('還沒有段：沒有走位', () => {
		expect(span(twoMembers(), 0)).toBeNull();
	});
});

const at = (segmentId: string, at: number) => ({ segmentId, at });

describe('設出發和到達', () => {
	// walking()：f1 開頭 → f2 在 20 秒（音樂 1 第 100 個半拍）→ f3 在 30 秒（口號 1 第 44 個 0.1 秒）

	it('每個人可以設不一樣的出發和到達，照設的走', () => {
		const flow = okFlow(
			setWalks(walking(), 'f2', {
				[A]: { depart: at('s1', 20), arrive: at('s1', 50) },
				[B]: { depart: at('s1', 60), arrive: at('s1', 80) }
			})
		);
		expect(flow.formations[1].walks).toEqual({
			[A]: { depart: at('s1', 20), arrive: at('s1', 50) },
			[B]: { depart: at('s1', 60), arrive: at('s1', 80) }
		});
		expectAt(flow, 7, A, [2, 0]);
		expectAt(flow, 10, A, [4, 0]);
		expect(memberWalk(flow, 'f2', B)).toEqual({ depart: at('s1', 60), arrive: at('s1', 80) });
	});

	it('出發可以是前一張、到達可以是這一張，可以跨段', () => {
		const flow = okFlow(
			setWalks(walking(), 'f3', { [A]: { depart: at('s1', 100), arrive: at('s2', 44) } })
		);
		expectAt(flow, 25, A, [4, 2.5]);
	});

	it('沒設的人照預設：最後一個八拍才走', () => {
		expect(memberWalk(walking(), 'f2', A)).toEqual({ depart: at('s1', 84), arrive: at('s1', 100) });
		expect(memberWalk(walking(), 'f3', A)).toEqual({ depart: at('s1', 100), arrive: at('s2', 44) });
	});

	it('對全隊套用：只寫進兩張站位位置不同的人，站著不動的人不寫', () => {
		// walking()：走到 f2 時小A 從 [0, 0] 走到 [4, 0]，小B 一直站在 [-2, 0]
		const w = { depart: at('s1', 20), arrive: at('s1', 50) };
		const flow = okFlow(setTeamWalks(walking(), 'f2', w));
		expect(flow.formations[1].walks).toEqual({ [A]: w });
		// 擋下來的規則跟 setWalks 一樣
		expect(setTeamWalks(walking(), 'f2', { depart: at('s1', 50), arrive: at('s1', 50) })).toEqual({
			kind: 'blocked',
			message: '出發要早於到達'
		});
		expect(setTeamWalks(walking(), 'f1', w).kind).toBe('blocked');
	});

	it('清掉設定：回到預設，沒清的人留著', () => {
		const set = okFlow(
			setWalks(walking(), 'f2', {
				[A]: { depart: at('s1', 20), arrive: at('s1', 50) },
				[B]: { depart: at('s1', 20), arrive: at('s1', 50) }
			})
		);
		const cleared = okFlow(clearWalks(set, 'f2', [A]));
		expect(cleared.formations[1].walks).toEqual({ [B]: { depart: at('s1', 20), arrive: at('s1', 50) } });
		expectAt(cleared, 16.8, A, [0, 0]);
		const all = okFlow(clearWalks(cleared, 'f2', [B]));
		expect(all.formations[1]).not.toHaveProperty('walks');
	});

	it('擋下來，流程不改：出發不早於到達', () => {
		const flow = walking();
		const r = setWalks(flow, 'f2', { [A]: { depart: at('s1', 50), arrive: at('s1', 50) } });
		expect(r).toEqual({ kind: 'blocked', message: '出發要早於到達' });
		expect(setWalks(flow, 'f2', { [A]: { depart: at('s1', 60), arrive: at('s1', 50) } }).kind).toBe(
			'blocked'
		);
	});

	it('擋下來：時間不在前一張和這一張之間', () => {
		const flow = walking();
		const message = '出發和到達要在前一張和這一張站位之間';
		// f3 前一張是 20 秒，19.8 秒太早
		expect(setWalks(flow, 'f3', { [A]: { depart: at('s1', 99), arrive: at('s2', 10) } })).toEqual({
			kind: 'blocked',
			message
		});
		expect(setWalks(flow, 'f2', { [A]: { depart: at('s1', 20), arrive: at('s1', 101) } })).toEqual({
			kind: 'blocked',
			message
		});
		// 超出那一段的格子（音樂 1 只有 128 個半拍）
		expect(setWalks(flow, 'f3', { [A]: { depart: at('s1', 100), arrive: at('s1', 130) } })).toEqual({
			kind: 'blocked',
			message
		});
	});

	it('擋下來：開頭那張、找不到站位或隊員', () => {
		const flow = walking();
		const w = { depart: at('s1', 0), arrive: at('s1', 10) };
		expect(setWalks(flow, 'f1', { [A]: w })).toEqual({
			kind: 'blocked',
			message: '開頭那張前面沒有站位，不能設出發和到達'
		});
		expect(setWalks(flow, 'nope', { [A]: w }).kind).toBe('blocked');
		expect(setWalks(flow, 'f2', { nobody: w }).kind).toBe('blocked');
		expect(clearWalks(flow, 'f1', [A]).kind).toBe('blocked');
	});

	it('例子：1–5 號照預設，6–10 號 2-1 出發 3-1 到，跑翻 10、9、8 號一個接一個', () => {
		// 音樂 1（150 BPM，一個半拍 0.2 秒）；開頭 → 4-1（第 48 個半拍，9.6 秒）
		let flow = okFlow(createFlow({ name: '例子', field: { strips: 9, layout: 'vertical' } }));
		flow = okFlow(
			addMembers(
				flow,
				Array.from({ length: 10 }, (_, i) => ({ name: `${i + 1}`, gender: 'F', globalRole: 'top' }) as const)
			)
		);
		flow = okFlow(addSegment(flow, 'music'));
		const ids = flow.members.map((m) => m.id);
		flow = okFlow(setPositions(flow, 'f1', Object.fromEntries(ids.map((id, i) => [id, [i - 5, 0]]))));
		flow = okFlow(insertFormation(flow, 9.6));
		flow = okFlow(setPositions(flow, 'f2', Object.fromEntries(ids.map((id, i) => [id, [i - 5, 4]]))));
		const w = (d: number, a: number) => ({ depart: at('s1', d), arrive: at('s1', a) });
		flow = okFlow(setWalks(flow, 'f2', Object.fromEntries(ids.slice(5).map((id) => [id, w(16, 32)]))));
		flow = okFlow(setWalks(flow, 'f2', { [ids[9]]: w(16, 22), [ids[8]]: w(20, 26), [ids[7]]: w(24, 30) }));

		const y = (sec: number, i: number) => positionsAt(flow, sec)[ids[i]][1];
		// 2-1（3.2 秒）：大家都還在原地
		for (let i = 0; i < 10; i++) expect(y(3.2, i)).toBeCloseTo(0, 9);
		// 2-4（4.4 秒）：10 號到了；9 號走了 1/3；8 號、6–7 號還在路上，1–5 號沒動
		expect(y(4.4, 9)).toBeCloseTo(4, 9);
		expect(y(4.4, 8)).toBeCloseTo(4 / 3, 9);
		expect(y(4.4, 7)).toBeCloseTo(0, 9);
		expect(y(4.4, 5)).toBeCloseTo(1.5, 9);
		expect(y(4.4, 0)).toBeCloseTo(0, 9);
		// 3-1（6.4 秒）：6–10 號都到了，1–5 號這時才出發
		for (let i = 5; i < 10; i++) expect(y(6.4, i)).toBeCloseTo(4, 9);
		for (let i = 0; i < 5; i++) expect(y(6.4, i)).toBeCloseTo(0, 9);
		expect(y(8, 0)).toBeCloseTo(2, 9);
		expect(y(9.6, 0)).toBeCloseTo(4, 9);
	});
});

describe('跟上一張一樣', () => {
	it('播放頭在站位上：選到的人改成上一張的位置，沒選到的人不動', () => {
		const flow = okFlow(setPositions(walking(), 'f2', { [B]: [1, 1] }));
		const r = matchPrevious(flow, 20.1, [A]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations[1].pos).toEqual({ [A]: [0, 0], [B]: [1, 1] });
		expect(r.inserted).toBe(false);
		expect(r.sec).toBe(20);
		expect(r.carried).toBe(0);
	});

	it('播放頭不在站位上：先插一張（大家帶入走到的地方），選到的人改成上一張的位置', () => {
		// 小A 16.8 秒（最後一個八拍）才出發，18 秒正走到一半。
		const r = matchPrevious(walking(), 18.05, [A]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.inserted).toBe(true);
		expect(r.flow.formations.map((f) => f.pos[A])).toEqual([
			[0, 0],
			[0, 0],
			[4, 0],
			[4, 5]
		]);
		// 小A 到這一拍都還站著，之後才走到原本的下一張。
		expect(r.sec).toBe(18);
		expectAt(r.flow, 17.6, A, [0, 0]);
		expectAt(r.flow, 18, A, [0, 0]);
		expectAt(r.flow, 20, A, [4, 0]);
	});

	it('改完往後帶，回傳往後帶到幾張', () => {
		const flow = okFlow(setPositions(walking(), 'f3', { [A]: [4, 0] }));
		const r = matchPrevious(flow, 20, [A]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations.map((f) => f.pos[A])).toEqual([
			[0, 0],
			[0, 0],
			[0, 0]
		]);
		expect(r.carried).toBe(1);
	});

	it('沒選人就擋下：先選人', () => {
		expect(matchPrevious(walking(), 20, [])).toEqual({ kind: 'blocked', message: '先選人' });
	});

	it('播放頭在開頭那張就擋下：開頭那張前面沒有站位', () => {
		const blocked = { kind: 'blocked', message: '開頭那張前面沒有站位' };
		expect(matchPrevious(walking(), 0.1, [A])).toEqual(blocked);
		expect(matchPrevious(twoMembers(), 0, [twoMembers().members[0].id])).toEqual(blocked);
	});

	it('找不到隊員就擋下', () => {
		expect(matchPrevious(walking(), 20, ['nobody']).kind).toBe('blocked');
	});
});

describe('一組人移到新位置（鏡像、對齊…共用）', () => {
	/** 把每個人往右挪 1 m。 */
	const right1 = (pos: Record<string, [number, number]>) =>
		Object.fromEntries(Object.entries(pos).map(([id, [x, y]]) => [id, [x + 1, y] as [number, number]]));

	it('播放頭在站位上：拿選到的人在那張的位置算新位置，改那張', () => {
		const r = moveGroup(walking(), 20.1, [A, B], right1);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.formations[1].pos).toEqual({ [A]: [5, 0], [B]: [-1, 0] });
		expect(r.inserted).toBe(false);
		expect(r.sec).toBe(20);
	});

	it('播放頭不在站位上：先插一張（大家帶入走到的地方），拿那一刻的位置算；改完往後帶', () => {
		// 18 秒小A 正走到一半（[1.5, 0] 附近），小B 站在 [-2, 0]。
		const r = moveGroup(walking(), 18.05, [B], right1);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.inserted).toBe(true);
		expect(r.flow.formations.map((f) => f.pos[B])).toEqual([
			[-2, 0],
			[-1, 0],
			[-1, 0],
			[-1, 0]
		]);
		expect(r.carried).toBe(2);
	});

	it('沒選人、找不到隊員就擋下；位置都沒變（也不用插站位）就擋下，不記一步', () => {
		expect(moveGroup(walking(), 20, [], right1)).toEqual({ kind: 'blocked', message: '先選人' });
		expect(moveGroup(walking(), 20, ['nobody'], right1).kind).toBe('blocked');
		expect(moveGroup(walking(), 20, [A], (pos) => pos)).toEqual({ kind: 'blocked', message: '位置都沒變' });
		expect(moveGroup(walking(), 18.05, [A], (pos) => pos).kind).toBe('ok');
	});
});

describe('這段的走位', () => {
	/** walking() 再把小A 的 f1→f2 設成 19.6 秒（第 98 個半拍）出發、20 秒到：4 公尺 0.4 秒，每秒 10 公尺。 */
	function rushed(): Flow {
		return okFlow(
			setWalks(walking(), 'f2', {
				[A]: { depart: { segmentId: 's1', at: 98 }, arrive: { segmentId: 's1', at: 100 } }
			})
		);
	}

	/** 在音樂 1 從第 start 個半拍開始、長 4 個半拍，加一個只有 memberId 的動作。 */
	function withAction(flow: Flow, memberId: string, category: 'tumbling' | 'dance', start: number) {
		return okFlow(
			addAction(flow, {
				segmentId: 's1',
				category,
				name: '',
				start,
				length: 4,
				note: '',
				members: [{ memberId, role: null }]
			})
		);
	}

	it('列出位置有變的人：起點、終點、出發和到達、速度', () => {
		const walks = formationWalks(walking(), 'f2');
		expect(walks).toHaveLength(1);
		const [w] = walks;
		expect(w.memberId).toBe(A);
		expect(w.from).toEqual([0, 0]);
		expect(w.to).toEqual([4, 0]);
		expect(w.departSec).toBeCloseTo(16.8, 9);
		expect(w.arriveSec).toBeCloseTo(20, 9);
		// 4 公尺 3.2 秒。
		expect(w.speed).toBeCloseTo(1.25, 9);
		expect(w.tooFast).toBe(false);
		expect(w.tiring).toBe(false);
	});

	it('位置一樣的人不算走位，就算 walks 裡有他的設定', () => {
		const flow = withWalk(walking(), 'f2', B, {
			depart: { segmentId: 's1', at: 90 },
			arrive: { segmentId: 's1', at: 100 }
		});
		expect(formationWalks(flow, 'f2').map((w) => w.memberId)).toEqual([A]);
	});

	it('每秒超過 4 公尺就是太快', () => {
		expect(TOO_FAST_MPS).toBe(4);
		const [w] = formationWalks(rushed(), 'f2');
		expect(w.speed).toBeCloseTo(10, 9);
		expect(w.tooFast).toBe(true);
		// 太快就只算太快，不另外算很喘。
		expect(w.tiring).toBe(false);
	});

	it('剛好每秒 4 公尺不算太快', () => {
		// 第 95 到 100 個半拍是 1 秒，走 4 公尺。
		const flow = okFlow(
			setWalks(walking(), 'f2', {
				[A]: { depart: { segmentId: 's1', at: 95 }, arrive: { segmentId: 's1', at: 100 } }
			})
		);
		const [w] = formationWalks(flow, 'f2');
		expect(w.speed).toBeCloseTo(4, 9);
		expect(w.tooFast).toBe(false);
		expect(w.tiring).toBe(true);
	});

	it('每秒超過 2.5 公尺、沒到 4 公尺就是很喘；剛好 2.5 不算', () => {
		expect(TIRING_MPS).toBe(2.5);
		const walk = (depart: number) =>
			formationWalks(
				okFlow(
					setWalks(walking(), 'f2', {
						[A]: { depart: { segmentId: 's1', at: depart }, arrive: { segmentId: 's1', at: 100 } }
					})
				),
				'f2'
			)[0];
		// 第 94 到 100 個半拍是 1.2 秒，走 4 公尺。
		expect(walk(94).speed).toBeCloseTo(4 / 1.2, 9);
		expect(walk(94)).toMatchObject({ tooFast: false, tiring: true });
		// 第 92 到 100 個半拍是 1.6 秒，剛好每秒 2.5 公尺。
		expect(walk(92).speed).toBeCloseTo(2.5, 9);
		expect(walk(92).tiring).toBe(false);
	});

	it('走位時間跟自己的騰翻動作重疊，就不算太快', () => {
		// 騰翻在第 96–100 個半拍（19.2–20 秒），跟 19.6–20 秒重疊。
		const [w] = formationWalks(withAction(rushed(), A, 'tumbling', 96), 'f2');
		expect(w.tooFast).toBe(false);
		expect(w.tiring).toBe(false);
	});

	it('別人的騰翻、自己的別種動作、時間沒重疊的騰翻，都還是太快', () => {
		expect(formationWalks(withAction(rushed(), B, 'tumbling', 96), 'f2')[0].tooFast).toBe(true);
		expect(formationWalks(withAction(rushed(), A, 'dance', 96), 'f2')[0].tooFast).toBe(true);
		// 第 94–98 個半拍（18.8–19.6 秒）剛好在出發時結束，不算重疊。
		expect(formationWalks(withAction(rushed(), A, 'tumbling', 94), 'f2')[0].tooFast).toBe(true);
	});

	it('速度的說明：正常只寫速度；太快寫至少要幾拍（每秒 4 公尺）；很喘寫不喘要幾拍（每秒 2.5 公尺）', () => {
		const text = (flow: Flow, formationId: string) => walkSpeedText(flow, formationWalks(flow, formationId)[0]);
		expect(text(walking(), 'f2')).toBe('每秒 1.3 公尺');
		// 4 公尺：每秒 4 公尺要 1 秒，150 BPM 一拍 0.4 秒，2.5 拍
		expect(text(rushed(), 'f2')).toBe('走太快：每秒 10.0 公尺，至少要 2.5 拍');
		// 第 94 到 100 個半拍走 4 公尺；每秒 2.5 公尺要剛好 1.6 秒 = 4 拍（不因為小數誤差多算半拍）
		const tiring = okFlow(
			setWalks(walking(), 'f2', { [A]: { depart: { segmentId: 's1', at: 94 }, arrive: { segmentId: 's1', at: 100 } } })
		);
		expect(text(tiring, 'f2')).toBe('很喘：每秒 3.3 公尺，不喘要 4 拍');
		// 口號段寫秒數：f3 在口號 1 的 4.4 秒，4.0–4.4 秒走 5 公尺；每秒 4 公尺要 1.25 秒 → 1.3 秒
		const chant = okFlow(
			setWalks(walking(), 'f3', { [A]: { depart: { segmentId: 's2', at: 40 }, arrive: { segmentId: 's2', at: 44 } } })
		);
		expect(text(chant, 'f3')).toBe('走太快：每秒 12.5 公尺，至少要 1.3 秒');
	});

	it('開頭那張或找不到站位：沒有走位', () => {
		expect(formationWalks(walking(), 'f1')).toEqual([]);
		expect(formationWalks(walking(), 'nope')).toEqual([]);
	});
});

describe('挪站位', () => {
	// walking()：f1 開頭 → f2 在 20 秒（音樂 1 第 100 個半拍，7-3）→ f3 在 30 秒（口號 1 第 44 個 0.1 秒）。
	// 音樂 1 是 150 BPM：一個半拍 0.2 秒，一個八拍 3.2 秒。

	it('站位時間改到那一拍，位置不變；沒設的人照預設跟著挪', () => {
		const r = moveFormation(walking(), 'f2', at('s1', 84));
		if (r.kind !== 'ok') throw new Error('擋下來了');
		expect(r.flow.formations[1]).toMatchObject({ id: 'f2', segmentId: 's1', at: 84 });
		expect(r.flow.formations[1].pos).toEqual(walking().formations[1].pos);
		expect(r.sec).toBeCloseTo(16.8, 9);
		// 小A 沒設：最後一個八拍才走，13.6 秒出發、16.8 秒到。
		expectAt(r.flow, 13.6, A, [0, 0]);
		expectAt(r.flow, 15.2, A, [2, 0]);
		expectAt(r.flow, 16.8, A, [4, 0]);
		expectAt(r.flow, 16.8, B, [-2, 0]);
	});

	it('要在前一張之後、後一張之前；開頭那張不能挪', () => {
		const flow = walking();
		const between = '站位 2 要挪到站位 1（1-1）之後、站位 3（口號 1 4.4 秒）之前';
		const blocked = (message: string) => ({ kind: 'blocked', message });
		expect(moveFormation(flow, 'f2', at('s1', 0))).toEqual(blocked(between));
		expect(moveFormation(flow, 'f2', at('s2', 44))).toEqual(blocked(between));
		expect(moveFormation(flow, 'f2', at('s2', 50))).toEqual(blocked(between));
		// 段外面的格子（音樂 1 只有 128 個半拍）
		expect(moveFormation(flow, 'f2', at('s1', 200))).toEqual(blocked(between));
		// 最後一張：後面是流程結尾（口號 1 只有 100 個 0.1 秒）
		const last = '站位 3 要挪到站位 2（音樂 1 7-3）之後、流程結尾之前';
		expect(moveFormation(flow, 'f3', at('s1', 100))).toEqual(blocked(last));
		expect(moveFormation(flow, 'f3', at('s2', 100))).toEqual(blocked(last));
		expect(moveFormation(flow, 'f1', at('s1', 4))).toEqual(blocked('開頭那張不能挪'));
		expect(moveFormation(flow, 'nope', at('s1', 4))).toEqual(blocked('找不到這張站位'));
	});

	it('挪到原本那一拍：流程不變（不算一步復原）', () => {
		const flow = walking();
		const r = moveFormation(flow, 'f2', at('s1', 100));
		if (r.kind !== 'ok') throw new Error('擋下來了');
		expect(r.flow).toBe(flow);
		expect(r.sec).toBeCloseTo(20, 9);
	});

	/** walking()，小A 在 f2 自己設：第 50 個半拍（10 秒）出發、第 80 個（16 秒）到，比 f2 早 4 秒到。 */
	const early = () =>
		okFlow(setWalks(walking(), 'f2', { [A]: { depart: at('s1', 50), arrive: at('s1', 80) } }));

	it('這張上自己設的出發和到達跟著挪一樣多，走的速度不變', () => {
		// 往前挪一個八拍（16 個半拍）
		const sooner = okFlow(moveFormation(early(), 'f2', at('s1', 84)));
		expect(memberWalk(sooner, 'f2', A)).toEqual({ depart: at('s1', 34), arrive: at('s1', 64) });
		expectAt(sooner, 9.8, A, [2, 0]);
		// 往後挪 10 個半拍
		const later = okFlow(moveFormation(early(), 'f2', at('s1', 110)));
		expect(memberWalk(later, 'f2', A)).toEqual({ depart: at('s1', 60), arrive: at('s1', 90) });
	});

	it('往前挪碰到前一張：出發夾在前一張，走位長度不變', () => {
		// 往前挪 60 個半拍到第 40 個（8 秒）：出發夾在開頭，還是走 30 個半拍，第 30 個到，之後等到站位時間
		const kept = okFlow(moveFormation(early(), 'f2', at('s1', 40)));
		expect(memberWalk(kept, 'f2', A)).toEqual({ depart: at('s1', 0), arrive: at('s1', 30) });
		// 剛好放得下：挪到第 30 個，出發在開頭、到達在站位時間
		const exact = okFlow(moveFormation(early(), 'f2', at('s1', 30)));
		expect(memberWalk(exact, 'f2', A)).toEqual({ depart: at('s1', 0), arrive: at('s1', 30) });
	});

	it('放不下就縮成前一張到新的站位時間整段走，出發不早於前一張', () => {
		// 測試員的例子：站位 3 在 5-1、站位 4 在 8-5，阿明 5-5 出發、8-1 到；站位 4 挪到 6-1。
		// 這裡是開頭（1-1）→ 第 20 個半拍（2-3），小A 原本走 30 個半拍：縮成 0 到 20。
		const short = okFlow(moveFormation(early(), 'f2', at('s1', 20)));
		expect(memberWalk(short, 'f2', A)).toEqual({ depart: at('s1', 0), arrive: at('s1', 20) });
		const tiny = okFlow(moveFormation(early(), 'f2', at('s1', 4)));
		expect(memberWalk(tiny, 'f2', A)).toEqual({ depart: at('s1', 0), arrive: at('s1', 4) });
	});

	it('跟著挪完不在格子上（跨到別段）就往前取', () => {
		// 口號 1（10 秒）→ 音樂 1；小B 9.9 秒出發、10.8 秒到 f2（11.6 秒）。f2 往後挪 0.2 秒：
		// 出發 10.1 秒在音樂 1 的格子中間，往前取到 10 秒；到達 11 秒剛好在格子上。
		const flow = okFlow(
			setWalks(chantThenMusic(), 'f2', { [B]: { depart: at('s1', 99), arrive: at('s2', 4) } })
		);
		const after = okFlow(moveFormation(flow, 'f2', at('s2', 9)));
		expect(memberWalk(after, 'f2', B)).toEqual({ depart: at('s2', 0), arrive: at('s2', 5) });
	});

	it('可以挪到別段：到口號段，沒設的人照口號段的預設整段走', () => {
		const after = okFlow(moveFormation(chantThenMusic(), 'f2', at('s1', 50)));
		expect(after.formations[1]).toMatchObject({ segmentId: 's1', at: 50 });
		expect(memberWalk(after, 'f2', A)).toEqual({ depart: at('s1', 0), arrive: at('s1', 50) });
	});

	it('下一張的設定不改；走位比挪之前短的人（兩段都算，一人算一次，照名單順序）是 squeezed', () => {
		// 小A 走到 f3：自己設 22 秒出發、27.6 秒（口號 1 第 20 個 0.1 秒）到。
		const flow = okFlow(
			setWalks(walking(), 'f3', { [A]: { depart: at('s1', 110), arrive: at('s2', 20) } })
		);
		// f2 往後挪到 24 秒：f3 那段的出發被夾到 24 秒，走的時間從 5.6 秒變 3.6 秒。
		const r = moveFormation(flow, 'f2', at('s1', 120));
		if (r.kind !== 'ok') throw new Error('擋下來了');
		expect(r.flow.formations[2]).toBe(flow.formations[2]);
		expect(memberWalk(r.flow, 'f3', A)).toEqual({ depart: at('s1', 120), arrive: at('s2', 20) });
		expect(r.squeezed).toEqual([A]);
		// 往前挪、速度不變或碰到前一張但放得下：沒人被壓短；放不下：壓短
		expect(moveFormation(early(), 'f2', at('s1', 84))).toMatchObject({ squeezed: [] });
		expect(moveFormation(early(), 'f2', at('s1', 40))).toMatchObject({ squeezed: [] });
		expect(moveFormation(early(), 'f2', at('s1', 20))).toMatchObject({ squeezed: [A] });
	});

	it('前一張以前、後一張以後，每個人每一刻的位置都不變', () => {
		let flow = okFlow(insertFormation(early(), 34));
		flow = okFlow(setPositions(flow, 'f4', { [A]: [0, 5] }));
		const after = okFlow(moveFormation(flow, 'f2', at('s1', 84)));
		for (const t of [0, 30, 31, 32.5, 34, 40]) {
			for (const id of [A, B]) expect(positionsAt(after, t)[id]).toEqual(positionsAt(flow, t)[id]);
		}
	});

	it('能挪的範圍：前一張和後一張的站位時間，在別段就加段名', () => {
		const flow = walking();
		expect(moveFormationHint(flow, 'f2')).toBe('可以挪到 1-1 之後、口號 1 4.4 秒 之前');
		expect(moveFormationHint(flow, 'f3')).toBe('可以挪到 音樂 1 7-3 之後');
		expect(moveFormationHint(flow, 'f1')).toBe('開頭那張不能挪');
	});
});
