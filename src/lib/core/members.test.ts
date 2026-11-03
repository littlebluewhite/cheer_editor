import { describe, expect, it } from 'vitest';
import {
	addMembers,
	createFlow,
	fieldGeometry,
	memberMarkers,
	setMarkers,
	setPositions,
	updateMember,
	type Flow,
	type NewMemberInput
} from './index';

function newFlow(): Flow {
	const r = createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } });
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

function okFlow(r: ReturnType<typeof addMembers>): Flow {
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

	it('新人出現在開頭站位，站在正面左邊、場地外那 1 m 裡', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA]));
		const [x, y] = flow.formations[0].pos[flow.members[0].id];
		// 9 條直放：場地左邊 x = -8.23，正面 y = 6.40，外圍到 -9.23、7.40。
		expect(x).toBeLessThan(-8.23);
		expect(x).toBeGreaterThanOrEqual(-9.23);
		expect(y).toBeGreaterThan(6.4);
		expect(y).toBeLessThanOrEqual(7.4);
	});

	it('一次加多人排成一排，從左往右每 1/2 格一個，圓點不會疊在一起', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA, xiaoA, xiaoA]));
		const ps = flow.members.map((m) => flow.formations[0].pos[m.id]);
		expect(ps.map((p) => p[1])).toEqual([ps[0][1], ps[0][1], ps[0][1]]);
		expect(ps.map((p) => p[0])).toEqual([
			expect.closeTo(-9.14, 2),
			expect.closeTo(-8.23, 2),
			expect.closeTo(-7.32, 2)
		]);
	});

	it('之後再加的人排在還沒擺好的人右邊', () => {
		let flow = okFlow(addMembers(newFlow(), [xiaoA, xiaoA]));
		flow = okFlow(addMembers(flow, [xiaoA]));
		const pos = flow.formations[0].pos;
		expect(pos[flow.members[2].id][0]).toBeCloseTo(-7.32, 2);
	});

	it('橫放場地也是正面左邊場地外', () => {
		const r = createFlow({ name: '臺灣盃', field: { strips: 5, layout: 'horizontal' } });
		const flow = okFlow(addMembers(okFlow(r), [xiaoA]));
		const [x, y] = flow.formations[0].pos[flow.members[0].id];
		expect(x).toBeLessThan(-6.4);
		expect(x).toBeGreaterThanOrEqual(-7.4);
		expect(y).toBeGreaterThan(4.57);
		expect(y).toBeLessThanOrEqual(5.57);
	});

	const fields = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((strips) =>
		(['vertical', 'horizontal'] as const).map((layout) => ({ strips, layout }))
	);
	const forty = Array.from({ length: 40 }, (_, i) => ({ ...xiaoA, name: `隊員${i + 1}` }));

	it.each(fields)('$strips 條 $layout：40 人一次加或一個一個加，都在場地外 1 m 內、圓點不疊在一起', (field) => {
		const empty = okFlow(createFlow({ name: '測試', field }));
		const atOnce = okFlow(addMembers(empty, forty));
		const oneByOne = forty.reduce((f, m) => okFlow(addMembers(f, [m])), empty);
		const { mat, outer } = fieldGeometry(field);
		for (const flow of [atOnce, oneByOne]) {
			const ps = Object.values(flow.formations[0].pos);
			expect(ps).toHaveLength(40);
			// 圓點半徑 0.3 m：兩人中心至少差 0.6 m 才不會疊到。
			for (const [i, [x1, y1]] of ps.entries())
				for (const [x2, y2] of ps.slice(i + 1)) expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThanOrEqual(0.6);
			for (const [x, y] of ps) {
				expect(x).toBeGreaterThanOrEqual(outer.x - 1e-9);
				expect(x).toBeLessThanOrEqual(outer.x + outer.width + 1e-9);
				expect(y).toBeGreaterThanOrEqual(outer.y - 1e-9);
				expect(y).toBeLessThanOrEqual(outer.y + outer.height + 1e-9);
				const onMat = x > mat.x && x < mat.x + mat.width && y > mat.y && y < mat.y + mat.height;
				expect(onMat).toBe(false);
			}
			// 第一個人在正面左邊的場地外
			const [x0, y0] = flow.formations[0].pos[flow.members[0].id];
			expect(x0).toBeLessThan(mat.x);
			expect(y0).toBeGreaterThan(mat.y + mat.height);
		}
	});

	it('有人已經站在等待的位置上：新人跳過那裡，不疊上去', () => {
		let flow = okFlow(addMembers(newFlow(), [xiaoA, xiaoA]));
		const [first, second] = flow.members.map((m) => flow.formations[0].pos[m.id]);
		// 把第一個人移走、第二個人留著；新人補第一個位置，再來的人跳過第二個位置
		flow = okFlow(setPositions(flow, 'f1', { [flow.members[0].id]: [0, 0] }));
		flow = okFlow(addMembers(flow, [xiaoA, xiaoA]));
		const pos = flow.formations[0].pos;
		expect(pos[flow.members[2].id]).toEqual(first);
		expect(pos[flow.members[3].id]).not.toEqual(second);
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

	it('滿 40 人就不能再加', () => {
		const forty = Array.from({ length: 40 }, (_, i) => ({ ...xiaoA, name: `隊員${i + 1}` }));
		const full = okFlow(addMembers(newFlow(), forty));
		expect(full.members).toHaveLength(40);
		expect(addMembers(full, [xiaoA])).toEqual({ kind: 'blocked', message: '一支流程最多 40 人' });

		const thirtyNine = okFlow(addMembers(newFlow(), forty.slice(1)));
		expect(addMembers(thirtyNine, [xiaoA, xiaoA]).kind).toBe('blocked');
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

	it('檔案裡的名字是空的：標記寫問號，不會當掉', () => {
		const base = people('王小明', '李美');
		const flow: Flow = {
			...base,
			markers: 'initial',
			members: base.members.map((m, i) => (i === 0 ? { ...m, name: '' } : m))
		};
		expect(memberMarkers(flow)).toEqual({ m1: '?', m2: '李' });
	});

	it('可以改回號碼', () => {
		const flow = okFlow(setMarkers(okFlow(setMarkers(people('王小明'), 'initial')), 'number'));
		expect(memberMarkers(flow)).toEqual({ m1: '1' });
	});
});
