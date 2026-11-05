import { describe, expect, it } from 'vitest';
import {
	addMemberLines,
	addMembers,
	createFlow,
	fieldGeometry,
	memberMarkers,
	moveMember,
	setMarkers,
	setPositions,
	updateMember,
	type CommandResult,
	type Flow,
	type NewMemberInput
} from './index';

function newFlow(): Flow {
	const r = createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } });
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

function okFlow(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

const xiaoA: NewMemberInput = { name: '小A', gender: 'F', globalRole: 'top' };

describe('加隊員', () => {
	it('新建的流程沒有隊員，開頭有一張站位', () => {
		const flow = newFlow();
		expect(flow.members).toEqual([]);
		expect(flow.formations).toHaveLength(1);
	});

	it('加一個隊員：名字、性別、全局角色照教練填的', () => {
		const flow = okFlow(addMembers(newFlow(), [{ name: ' 小A ', gender: 'F', globalRole: 'base' }]));
		expect(flow.members).toHaveLength(1);
		expect(flow.members[0]).toMatchObject({ name: '小A', gender: 'F', globalRole: 'base' });
	});

	it('沒填名字、沒選性別或全局角色就擋下', () => {
		const flow = newFlow();
		expect(addMembers(flow, [{ ...xiaoA, name: ' ' }])).toEqual({
			kind: 'blocked',
			message: '請填隊員名字'
		});
		expect(addMembers(flow, [{ ...xiaoA, gender: null }])).toEqual({
			kind: 'blocked',
			message: '請選性別'
		});
		expect(addMembers(flow, [{ ...xiaoA, globalRole: null }])).toEqual({
			kind: 'blocked',
			message: '請選全局角色'
		});
	});

	it('新人排在名單最後，每人有不同的 id', () => {
		let flow = okFlow(addMembers(newFlow(), [xiaoA, { ...xiaoA, name: '小B' }]));
		flow = okFlow(addMembers(flow, [{ ...xiaoA, name: '小C' }]));
		expect(flow.members.map((m) => m.name)).toEqual(['小A', '小B', '小C']);
		expect(new Set(flow.members.map((m) => m.id)).size).toBe(3);
	});

	const C = 6 * 0.3048;

	it('新人排進開頭那張站位最靠近場地中間的格點（格子正中間）：9 條直放第一個人站在正中心', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA]));
		const [x, y] = flow.formations[0].pos[flow.members[0].id];
		expect(x).toBeCloseTo(0, 6);
		expect(y).toBeCloseTo(0, 6);
	});

	it('一次加多人：一個一個排進下一個最近的空格點，一樣近時先正面、再左邊', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA, xiaoA, xiaoA, xiaoA, xiaoA]));
		const ps = flow.members.map((m) => flow.formations[0].pos[m.id]);
		expect(ps.map(([x, y]) => [x / C, y / C].map((v) => Math.round(v * 2) / 2 + 0))).toEqual([
			[0, 0],
			[0, 1],
			[-1, 0],
			[1, 0],
			[0, -1]
		]);
	});

	it('格點附近（不到半格）已經有人：跳過那個格點', () => {
		let flow = okFlow(addMembers(newFlow(), [xiaoA]));
		// 把第一個人挪到正中心旁邊 1/4 格
		flow = okFlow(setPositions(flow, 'f1', { [flow.members[0].id]: [C / 4, 0] }));
		flow = okFlow(addMembers(flow, [xiaoA, xiaoA]));
		const pos = flow.formations[0].pos;
		expect(pos[flow.members[1].id]).toEqual([expect.closeTo(0, 6), expect.closeTo(C, 6)]);
		expect(pos[flow.members[2].id]).toEqual([expect.closeTo(-C, 6), expect.closeTo(0, 6)]);
	});

	it('9 條直放加 20 人：全部在墊子上某一格的正中間，不在格線、接縫或墊子邊上', () => {
		const flow = okFlow(addMembers(newFlow(), Array(20).fill(xiaoA)));
		const { mat } = fieldGeometry(flow.field);
		const ps = Object.values(flow.formations[0].pos);
		expect(ps).toHaveLength(20);
		for (const [x, y] of ps) {
			const cx = (x - mat.x) / C;
			const cy = (y - mat.y) / C;
			expect(cx - Math.floor(cx)).toBeCloseTo(0.5, 6);
			expect(cy - Math.floor(cy)).toBeCloseTo(0.5, 6);
			expect(cx).toBeGreaterThan(0);
			expect(cx).toBeLessThan(9);
			expect(cy).toBeGreaterThan(0);
			expect(cy).toBeLessThan(7);
		}
	});

	it('後面的站位沒有新人的位置：用開頭那張的同一個位置', () => {
		const before = okFlow(addMembers(newFlow(), [xiaoA]));
		const twoFormations = {
			...before,
			formations: [...before.formations, { ...before.formations[0], id: 'f2', at: 8, pos: { m1: [3, 3] as [number, number] } }]
		};
		const flow = okFlow(addMembers(twoFormations, [xiaoA]));
		const id = flow.members[1].id;
		expect(flow.formations[1].pos[id]).toEqual(flow.formations[0].pos[id]);
		expect(flow.formations[1].pos.m1).toEqual([3, 3]);
	});

	it('格點都有人了才排場外：1 條直放只有 7 格，第 8 個人起在正面外從左到右排成一列', () => {
		const field = { strips: 1, layout: 'vertical' } as const;
		const flow = okFlow(addMembers(okFlow(createFlow({ name: '小場地', field })), Array(11).fill(xiaoA)));
		const { mat } = fieldGeometry(field);
		const ps = flow.members.map((m) => flow.formations[0].pos[m.id]);
		const onMat = ([x, y]: number[]) => x > mat.x && x < mat.x + mat.width && y > mat.y && y < mat.y + mat.height;
		expect(ps.slice(0, 7).every(onMat)).toBe(true);
		const outside = ps.slice(7);
		expect(outside[0][0]).toBeLessThan(mat.x);
		for (const [, y] of outside) expect(y).toBeCloseTo(outside[0][1], 6);
		expect(outside[0][1]).toBeGreaterThan(mat.y + mat.height);
		for (let i = 1; i < outside.length; i++) expect(outside[i][0] - outside[i - 1][0]).toBeCloseTo(C / 2, 6);
	});

	const fields = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((strips) =>
		(['vertical', 'horizontal'] as const).map((layout) => ({ strips, layout }))
	);
	const forty = Array.from({ length: 40 }, (_, i) => ({ ...xiaoA, name: `隊員${i + 1}` }));

	it.each(fields)('$strips 條 $layout：40 人一次加或一個一個加，整個圓點都在外圍框裡、場外的人不壓到墊子邊、圓點不疊在一起', (field) => {
		const empty = okFlow(createFlow({ name: '測試', field }));
		const atOnce = okFlow(addMembers(empty, forty));
		const oneByOne = forty.reduce((f, m) => okFlow(addMembers(f, [m])), empty);
		const { outer, mat } = fieldGeometry(field);
		expect(oneByOne.formations[0].pos).toEqual(atOnce.formations[0].pos);
		const ps = Object.values(atOnce.formations[0].pos);
		expect(ps).toHaveLength(40);
		// 圓點半徑 0.3 m：兩人中心至少差 0.6 m 才不會疊到。
		for (const [i, [x1, y1]] of ps.entries())
			for (const [x2, y2] of ps.slice(i + 1)) expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThanOrEqual(0.6);
		const R = 0.3;
		for (const [x, y] of ps) {
			expect(x - R).toBeGreaterThanOrEqual(outer.x - 1e-9);
			expect(x + R).toBeLessThanOrEqual(outer.x + outer.width + 1e-9);
			expect(y - R).toBeGreaterThanOrEqual(outer.y - 1e-9);
			expect(y + R).toBeLessThanOrEqual(outer.y + outer.height + 1e-9);
			// 墊子外的人：圓點整個在墊子外，不壓到墊子的邊
			const dx = Math.max(mat.x - x, 0, x - mat.x - mat.width);
			const dy = Math.max(mat.y - y, 0, y - mat.y - mat.height);
			if (dx || dy) expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(R);
		}
	});

	it('改名字（候補上場）：同一個人、位置不變、名單順序不變', () => {
		const before = okFlow(addMembers(newFlow(), [xiaoA, { ...xiaoA, name: '小B' }]));
		const id = before.members[0].id;
		const after = okFlow(updateMember(before, id, { name: ' 候補小C ' }));
		expect(after.members.map((m) => m.name)).toEqual(['候補小C', '小B']);
		expect(after.members[0]).toMatchObject({ id, gender: 'F', globalRole: 'top' });
		expect(after.formations[0].pos[id]).toEqual(before.formations[0].pos[id]);
	});

	it('可以改性別和全局角色，互不帶入', () => {
		const before = okFlow(addMembers(newFlow(), [xiaoA]));
		const id = before.members[0].id;
		const after = okFlow(updateMember(before, id, { gender: 'M' }));
		expect(after.members[0]).toMatchObject({ gender: 'M', globalRole: 'top' });
		expect(okFlow(updateMember(after, id, { globalRole: 'base' })).members[0]).toMatchObject({
			gender: 'M',
			globalRole: 'base'
		});
	});

	it('名字改成空白就擋下', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA]));
		expect(updateMember(flow, flow.members[0].id, { name: '  ' })).toEqual({
			kind: 'blocked',
			message: '請填隊員名字'
		});
	});

	it('滿 40 人就不能再加；超過時寫還能加幾人', () => {
		const forty = Array.from({ length: 40 }, (_, i) => ({ ...xiaoA, name: `隊員${i + 1}` }));
		const full = okFlow(addMembers(newFlow(), forty));
		expect(full.members).toHaveLength(40);
		expect(addMembers(full, [xiaoA])).toEqual({ kind: 'blocked', message: '一支流程最多 40 人，已經滿了' });

		const thirtyEight = okFlow(addMembers(newFlow(), forty.slice(2)));
		expect(addMembers(thirtyEight, [xiaoA, xiaoA, xiaoA])).toEqual({
			kind: 'blocked',
			message: '一支流程最多 40 人，這次加 3 人，只能再加 2 人'
		});
	});

	it('隊員名字最多 20 個字：加的時候和改的時候都擋', () => {
		const twenty = '一二三四五六七八九十一二三四五六七八九十';
		expect(addMembers(newFlow(), [{ ...xiaoA, name: twenty }]).kind).toBe('ok');
		expect(addMembers(newFlow(), [{ ...xiaoA, name: twenty + '一' }])).toEqual({
			kind: 'blocked',
			message: '隊員名字最多 20 個字'
		});
		const flow = okFlow(addMembers(newFlow(), [xiaoA]));
		expect(updateMember(flow, flow.members[0].id, { name: twenty + '一' })).toEqual({
			kind: 'blocked',
			message: '隊員名字最多 20 個字'
		});
	});
	it('開檔進來名字超過 20 個字的人：名字沒改，還是可以改性別和全局角色', () => {
		const long = '一二三四五六七八九十一二三四五六七八九十一';
		const added = okFlow(addMembers(newFlow(), [xiaoA]));
		const flow = { ...added, members: added.members.map((m) => ({ ...m, name: long })) };
		const id = flow.members[0].id;
		expect(okFlow(updateMember(flow, id, { gender: 'M' })).members[0]).toMatchObject({ name: long, gender: 'M' });
		expect(okFlow(updateMember(flow, id, { name: long, globalRole: 'base' })).members[0]).toMatchObject({
			globalRole: 'base'
		});
	});
});

describe('貼上名單加隊員', () => {
	const picked = { gender: 'F', globalRole: 'top' } as const;
	const none = { gender: null, globalRole: null };

	it('一行一個名字：用表單選的性別和全局角色；空行跳過', () => {
		const r = addMemberLines(newFlow(), '小A\n\n 小B \n', picked);
		expect(r).toMatchObject({ kind: 'ok', errors: [], rejected: [] });
		const flow = okFlow(r);
		expect(flow.members).toMatchObject([
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'F', globalRole: 'top' }
		]);
	});

	it('從試算表貼「名字<Tab>性別<Tab>全局角色」：每一行用自己的性別和全局角色', () => {
		const flow = okFlow(addMemberLines(newFlow(), '王小明\t男\t底層\n李美\t女\t上層', none));
		expect(flow.members).toMatchObject([
			{ name: '王小明', gender: 'M', globalRole: 'base' },
			{ name: '李美', gender: 'F', globalRole: 'top' }
		]);
	});

	it('認不得的行列進錯誤（寫第幾行），其他行照加；所有錯誤一次列出', () => {
		const text = ['小A', '小B\t男生\t底層', '小C\t女\t中層', '小D\t女', '小E\t男\t上層'].join('\n');
		const r = addMemberLines(newFlow(), text, picked);
		expect(r).toMatchObject({
			kind: 'ok',
			errors: [
				'第 2 行「小B」：性別要寫「男」或「女」',
				'第 3 行「小C」：全局角色要寫「底層」或「上層」',
				'第 4 行「小D」：一行寫一個名字，或「名字、性別、全局角色」三欄（用 Tab 隔開）'
			],
			rejected: ['小B\t男生\t底層', '小C\t女\t中層', '小D\t女']
		});
		expect(okFlow(r).members.map((m) => m.name)).toEqual(['小A', '小E']);
	});

	it('沒選性別、全局角色，名字太長：每一行的錯一次列出；一行都加不了就擋下', () => {
		const long = '一二三四五六七八九十一二三四五六七八九十一';
		const r = addMemberLines(newFlow(), `小A\n${long}\t男\t底層`, { gender: null, globalRole: null });
		expect(r).toEqual({
			kind: 'blocked',
			message: `第 1 行「小A」：請選性別；請選全局角色\n第 2 行「${long}」：隊員名字最多 20 個字`
		});
	});

	it('試算表三欄有空格：不偷用表單選的，列出要寫什麼', () => {
		expect(addMemberLines(newFlow(), '小A\t\t', picked)).toEqual({
			kind: 'blocked',
			message: '性別要寫「男」或「女」；全局角色要寫「底層」或「上層」'
		});
	});

	it('只有一行：錯誤不寫第幾行', () => {
		expect(addMemberLines(newFlow(), '小A', { gender: 'F', globalRole: null })).toEqual({
			kind: 'blocked',
			message: '請選全局角色'
		});
		expect(addMemberLines(newFlow(), '  \n', picked)).toEqual({ kind: 'blocked', message: '請填隊員名字' });
	});

	it('超過 40 人：一個都不加，寫還能加幾人，其他錯誤也一起列出', () => {
		const full = okFlow(addMemberLines(newFlow(), Array.from({ length: 39 }, (_, i) => `隊員${i + 1}`).join('\n'), picked));
		expect(addMemberLines(full, '小A\n小B\t男生\t底層', picked)).toEqual({
			kind: 'blocked',
			message: '第 2 行「小B」：性別要寫「男」或「女」\n一支流程最多 40 人，這次加 2 人，只能再加 1 人'
		});
	});
});

describe('標記', () => {
	const people = (...names: string[]) =>
		okFlow(addMembers(newFlow(), names.map((name) => ({ ...xiaoA, name }))));

	it('新流程用號碼：名單第幾個就是幾號', () => {
		const flow = people('王小明', '李大華', '陳美');
		expect(memberMarkers(flow)).toEqual({ m1: '1', m2: '2', m3: '3' });
	});

	it('改成開頭字：每人寫名字的第一個字，英文寫大寫', () => {
		const flow = okFlow(setMarkers(people('王小明', '李大華', 'amy'), 'initial'));
		expect(flow.markers).toBe('initial');
		expect(memberMarkers(flow)).toEqual({ m1: '王', m2: '李', m3: 'A' });
	});

	it('開頭字撞在一起：再帶名字裡第一個不一樣的字，其他人照舊一個字', () => {
		const flow = okFlow(setMarkers(people('王小明', '王大華', '李美', '王小美'), 'initial'));
		expect(memberMarkers(flow)).toEqual({ m1: '王明', m2: '王大', m3: '李', m4: '王美' });
	});

	it('暱稱都是「小」開頭：小A、小B 整個名字當標記', () => {
		const flow = okFlow(setMarkers(people('小A', '小B'), 'initial'));
		expect(memberMarkers(flow)).toEqual({ m1: '小A', m2: '小B' });
	});

	it('分不出來（同名、或一個名字只有一個字）：開頭字後面加第幾個', () => {
		const flow = okFlow(setMarkers(people('王', '王', '王美'), 'initial'));
		expect(memberMarkers(flow)).toEqual({ m1: '王1', m2: '王2', m3: '王美' });
	});

	it('多帶的字只在一個人名字裡出現才用，不會兩個人帶到同一個字', () => {
		const flow = okFlow(setMarkers(people('王世傑', '王志世', '王志明'), 'initial'));
		expect(memberMarkers(flow)).toEqual({ m1: '王傑', m2: '王1', m3: '王明' });
	});

	it('加第幾個時跳過別人已經用掉的標記', () => {
		const flow = okFlow(setMarkers(people('王', '王1'), 'initial'));
		expect(memberMarkers(flow)).toEqual({ m1: '王2', m2: '王1' });
	});

	it('加第幾個時也跳過別人的名字：甲11 不會寫成另一個人的「甲10」', () => {
		const names = Array.from({ length: 14 }, (_, i) => `甲${i + 1}`);
		const flow = okFlow(setMarkers(people(...names), 'initial'));
		const markers = memberMarkers(flow);
		const nameOf = Object.fromEntries(flow.members.map((m) => [m.id, m.name]));
		for (const [id, marker] of Object.entries(markers)) {
			const other = flow.members.find((m) => m.id !== id && m.name === marker);
			expect(other, `${nameOf[id]} 的標記「${marker}」是別人的名字`).toBeUndefined();
		}
		expect(new Set(Object.values(markers)).size).toBe(14);
	});

	it('檔案裡的名字是空的：標記寫問號，不會當掉', () => {
		const base = people('王小明', '李美');
		const flow: Flow = {
			...base,
			markers: 'initial',
			members: base.members.map((m, i) => (i === 0 ? { ...m, name: '' } : m))
		};
		expect(memberMarkers(flow)).toEqual({ m1: '?', m2: '李' });
	});

	it('名字後面的數字整串當一個字：新人1 到新人10，新人10 寫「新10」，每個人都不同', () => {
		const names = Array.from({ length: 10 }, (_, i) => `新人${i + 1}`);
		const markers = memberMarkers(okFlow(setMarkers(people(...names), 'initial')));
		expect(markers.m1).toBe('新1');
		expect(markers.m10).toBe('新10');
		expect(new Set(Object.values(markers)).size).toBe(10);
	});

	it('可以改回號碼', () => {
		const flow = okFlow(setMarkers(okFlow(setMarkers(people('王小明'), 'initial')), 'number'));
		expect(memberMarkers(flow)).toEqual({ m1: '1' });
	});
});

describe('隊員排順序', () => {
	const people = (...names: string[]) =>
		okFlow(addMembers(newFlow(), names.map((name) => ({ ...xiaoA, name }))));

	it('把一個人移到名單上第幾個：其他人依序補上，號碼跟著變，id 不變', () => {
		const flow = okFlow(moveMember(people('小A', '小B', '小C'), 'm3', 0));
		expect(flow.members.map((m) => m.name)).toEqual(['小C', '小A', '小B']);
		expect(memberMarkers(flow)).toEqual({ m3: '1', m1: '2', m2: '3' });
	});

	it('往下移一個：跟下面那個人換位置', () => {
		const flow = okFlow(moveMember(people('小A', '小B', '小C'), 'm1', 1));
		expect(flow.members.map((m) => m.name)).toEqual(['小B', '小A', '小C']);
	});

	it('站位、動作不動（都記 id）', () => {
		const before = people('小A', '小B');
		const after = okFlow(moveMember(before, 'm2', 0));
		expect(after.formations).toBe(before.formations);
		expect(after.actions).toBe(before.actions);
	});

	it('已經在第一個、最後一個就擋下；找不到人也擋下', () => {
		const flow = people('小A', '小B');
		expect(moveMember(flow, 'm1', -1)).toEqual({ kind: 'blocked', message: '已經是第一個了' });
		expect(moveMember(flow, 'm2', 2)).toEqual({ kind: 'blocked', message: '已經是最後一個了' });
		expect(moveMember(flow, 'm9', 0)).toEqual({ kind: 'blocked', message: '找不到這個隊員' });
	});

	it('移到原本的位置：流程不變（不算一步）', () => {
		const flow = people('小A', '小B');
		expect(moveMember(flow, 'm1', 0)).toEqual({ kind: 'ok', flow });
	});
});
