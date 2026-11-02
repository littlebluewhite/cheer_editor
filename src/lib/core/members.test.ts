import { describe, expect, it } from 'vitest';
import { addMembers, createFlow, updateMember, type Flow, type NewMemberInput } from './index';

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

	it('新人出現在開頭站位，站在正面左邊、墊子外那 1 m 裡', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA]));
		const [x, y] = flow.formations[0].pos[flow.members[0].id];
		// 9 條直放：墊子左邊 x = -8.23，正面 y = 6.40，外圍到 7.40。
		expect(x).toBeCloseTo(-8.23, 2);
		expect(y).toBeGreaterThan(6.4);
		expect(y).toBeLessThanOrEqual(7.4);
	});

	it('一次加多人排成一排，從左往右，不疊在一起', () => {
		const flow = okFlow(addMembers(newFlow(), [xiaoA, xiaoA, xiaoA]));
		const ps = flow.members.map((m) => flow.formations[0].pos[m.id]);
		expect(ps.map((p) => p[1])).toEqual([ps[0][1], ps[0][1], ps[0][1]]);
		expect(ps.map((p) => p[0])).toEqual([
			expect.closeTo(-8.23, 2),
			expect.closeTo(-7.32, 2),
			expect.closeTo(-6.4, 2)
		]);
	});

	it('之後再加的人排在還沒擺好的人右邊', () => {
		let flow = okFlow(addMembers(newFlow(), [xiaoA, xiaoA]));
		flow = okFlow(addMembers(flow, [xiaoA]));
		const pos = flow.formations[0].pos;
		expect(pos[flow.members[2].id][0]).toBeCloseTo(-6.4, 2);
	});

	it('橫放場地也是正面左邊墊子外', () => {
		const r = createFlow({ name: '臺灣盃', field: { strips: 5, layout: 'horizontal' } });
		const flow = okFlow(addMembers(okFlow(r), [xiaoA]));
		const [x, y] = flow.formations[0].pos[flow.members[0].id];
		expect(x).toBeCloseTo(-6.4, 2);
		expect(y).toBeGreaterThan(4.57);
		expect(y).toBeLessThanOrEqual(5.57);
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
