import { describe, expect, it } from 'vitest';
import { addMembers, createFlow, setPositions, type CommandResult, type Flow } from './index';

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
