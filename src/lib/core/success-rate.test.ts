import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	disableSuccessRate,
	enableSuccessRate,
	phaseColor,
	setSquad,
	squadName,
	updateAction,
	updateSegment,
	type ActionCategory,
	type CommandResult,
	type Flow
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（4 個八拍）；隊員小美（上層）、小A、小B、小芳（上層）。x1：Lib（技巧），四個人都在裡面。 */
function sample(category: ActionCategory = 'stunt'): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '側底' },
		{ memberId: 'm4', role: '上層' }
	];
	return flowOf(addAction(flow, { segmentId: 's1', category, name: 'Lib', start: 0, length: 16, note: '', members }));
}

const actionOf = (flow: Flow, id = 'x1') => flow.actions.find((a) => a.id === id)!;

describe('打開記成功率', () => {
	it('技巧：先填上法、中段、下法，紀錄是空的', () => {
		const flow = flowOf(enableSuccessRate(sample('stunt'), 'x1'));
		expect(actionOf(flow).successRate).toEqual({
			phases: [
				{ id: 'p1', kind: 'load', name: '' },
				{ id: 'p2', kind: 'hold', name: '' },
				{ id: 'p3', kind: 'dismount', name: '' }
			],
			records: []
		});
	});

	const kindsAndNames = (flow: Flow) =>
		actionOf(flow).successRate?.phases.map((p) => [p.kind, p.name]);

	it.each([
		['pyramid', [['load', ''], ['dismount', '']]],
		['toss', [['whole', '拋投']]],
		['tumbling', [['whole', '騰翻']]],
		['jump', []],
		['dance', []],
		['other', []]
	] as const)('大類 %s：先填的環節照大類', (category, expected) => {
		const flow = flowOf(enableSuccessRate(sample(category), 'x1'));
		expect(kindsAndNames(flow)).toEqual(expected);
		expect(actionOf(flow).successRate?.records).toEqual([]);
	});

	it('金字塔：動作裡全部的人放第 1 組', () => {
		const flow = flowOf(enableSuccessRate(sample('pyramid'), 'x1'));
		expect(actionOf(flow).members.map((m) => m.squad)).toEqual([1, 1, 1, 1]);
	});

	it('別的大類：沒有人分組', () => {
		const flow = flowOf(enableSuccessRate(sample('stunt'), 'x1'));
		expect(actionOf(flow).members.map((m) => m.squad)).toEqual([undefined, undefined, undefined, undefined]);
	});

	it('環節的 id 在流程裡不重用：別的動作打開、關掉再打開，都是新的 id', () => {
		let flow = flowOf(
			addAction(sample(), {
				segmentId: 's1',
				category: 'toss',
				name: '籃拋',
				start: 32,
				length: 16,
				note: '',
				members: [{ memberId: 'm1', role: null }]
			})
		);
		flow = flowOf(enableSuccessRate(flow, 'x1'));
		flow = flowOf(enableSuccessRate(flow, 'x2'));
		flow = flowOf(disableSuccessRate(flow, 'x1'));
		flow = flowOf(disableSuccessRate(flow, 'x2'));
		flow = flowOf(enableSuccessRate(flow, 'x1'));
		const ids = (id: string) => actionOf(flow, id).successRate?.phases.map((p) => p.id);
		expect(ids('x1')).toEqual(['p5', 'p6', 'p7']);
	});
});

describe('關掉記成功率', () => {
	it('環節、組、紀錄都拿掉，動作回到沒打開的樣子', () => {
		const before = sample('pyramid');
		const on = flowOf(enableSuccessRate(before, 'x1'));
		const off = flowOf(disableSuccessRate(on, 'x1'));
		expect(actionOf(off)).toEqual(actionOf(before));
		expect('successRate' in actionOf(off)).toBe(false);
		expect(actionOf(off).members.some((m) => 'squad' in m)).toBe(false);
	});
});

describe('設組', () => {
	const on = (category: ActionCategory = 'stunt') => flowOf(enableSuccessRate(sample(category), 'x1'));
	const squads = (flow: Flow) => actionOf(flow).members.map((m) => m.squad);

	it('給隊員第幾組；給 null 就是沒分組', () => {
		let flow = flowOf(setSquad(on(), 'x1', 'm1', 1));
		flow = flowOf(setSquad(flow, 'x1', 'm2', 2));
		expect(squads(flow)).toEqual([1, 2, undefined, undefined]);
		flow = flowOf(setSquad(flow, 'x1', 'm1', null));
		expect(squads(flow)).toEqual([undefined, 2, undefined, undefined]);
		expect('squad' in actionOf(flow).members[0]).toBe(false);
	});

	it.each([
		['tumbling', '騰翻'],
		['jump', '跳躍']
	] as const)('%s 的動作不分組，擋下來並說原因', (category, label) => {
		expect(setSquad(on(category), 'x1', 'm1', 1)).toEqual({
			kind: 'blocked',
			message: `${label}的動作不分組，每個人自己算`
		});
	});

	it('沒打開記成功率不能分組', () => {
		expect(setSquad(sample(), 'x1', 'm1', 1)).toEqual({ kind: 'blocked', message: '先打開記成功率才能分組' });
	});

	it.each([0, -1, 1.5])('組要是正整數（%s 被擋）', (squad) => {
		expect(setSquad(on(), 'x1', 'm1', squad)).toEqual({ kind: 'blocked', message: '組要是正整數' });
	});

	it('隊員不在動作裡被擋', () => {
		const flow = flowOf(
			addMembers(on(), [{ name: '小D', gender: 'F', globalRole: 'top' }])
		);
		expect(setSquad(flow, 'x1', 'm5', 1)).toEqual({ kind: 'blocked', message: '這個隊員不在動作裡' });
	});
});

describe('組的名字', () => {
	/** x1 打開記成功率，照給的 [隊員, 第幾組] 分組。 */
	function grouped(pairs: [string, number][], flow = sample()): Flow {
		flow = flowOf(enableSuccessRate(flow, 'x1'));
		for (const [memberId, squad] of pairs) flow = flowOf(setSquad(flow, 'x1', memberId, squad));
		return flow;
	}

	it('第 n 組加上組裡任務角色是上層的人', () => {
		const flow = grouped([['m1', 1], ['m2', 1], ['m3', 1]]);
		expect(squadName(flow, actionOf(flow), 1)).toBe('第 1 組 小美');
	});

	it('好幾個上層：用名單上第一個（不是動作裡的順序）', () => {
		let flow = sample();
		const reversed = actionOf(flow).members.toReversed();
		flow = flowOf(updateAction(flow, 'x1', { members: reversed }));
		flow = grouped([['m4', 2], ['m1', 2]], flow);
		expect(actionOf(flow).members[0].memberId).toBe('m4');
		expect(squadName(flow, actionOf(flow), 2)).toBe('第 2 組 小美');
	});

	it('沒有上層就只叫第 n 組', () => {
		const flow = grouped([['m2', 3], ['m3', 3]]);
		expect(squadName(flow, actionOf(flow), 3)).toBe('第 3 組');
	});
});

describe('組跟著改動作', () => {
	/** x1 打開、分成兩組（小美、小A 第 1 組；小B、小芳 第 2 組）；x2 是後面的另一個動作（大類照給的），只有小美。 */
	function twoActions(category: ActionCategory, on: boolean): Flow {
		let flow = flowOf(enableSuccessRate(sample(), 'x1'));
		for (const [memberId, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
			flow = flowOf(setSquad(flow, 'x1', memberId, squad));
		}
		flow = flowOf(
			addAction(flow, {
				segmentId: 's1',
				category,
				name: '',
				start: 32,
				length: 16,
				note: '',
				members: [{ memberId: 'm1', role: null }]
			})
		);
		return on ? flowOf(enableSuccessRate(flow, 'x2')) : flow;
	}
	const copyPeople = (flow: Flow) =>
		flowOf(updateAction(flow, 'x2', { members: actionOf(flow, 'x1').members.map((m) => ({ ...m })) }));
	const squads = (flow: Flow, id: string) => actionOf(flow, id).members.map((m) => m.squad);

	it('從別的動作複製人：連組一起帶', () => {
		const flow = copyPeople(twoActions('stunt', true));
		expect(squads(flow, 'x2')).toEqual([1, 1, 2, 2]);
	});

	it('複製到沒打開記成功率的動作：組不帶', () => {
		const flow = copyPeople(twoActions('stunt', false));
		expect(actionOf(flow, 'x2').members.some((m) => 'squad' in m)).toBe(false);
	});

	it('複製到騰翻、跳躍的動作：組不帶', () => {
		const flow = copyPeople(twoActions('jump', true));
		expect(actionOf(flow, 'x2').members.some((m) => 'squad' in m)).toBe(false);
	});

	it('大類換成騰翻或跳躍：組拿掉，環節留著', () => {
		const before = twoActions('stunt', false);
		const flow = flowOf(updateAction(before, 'x1', { category: 'tumbling' }));
		expect(actionOf(flow).members.some((m) => 'squad' in m)).toBe(false);
		expect(actionOf(flow).successRate).toEqual(actionOf(before).successRate);
	});

	it('組不是正整數被擋', () => {
		const flow = twoActions('stunt', true);
		const members = [{ memberId: 'm1', role: null, squad: 0 }];
		expect(updateAction(flow, 'x2', { members })).toEqual({ kind: 'blocked', message: '組要是正整數' });
	});
});

describe('環節的顏色', () => {
	it('沒挑顏色用種類的顏色：上法青、中段石板灰、轉接金、下法紫、整體灰', () => {
		const kinds = ['load', 'hold', 'transition', 'dismount', 'whole'] as const;
		expect(kinds.map((kind) => phaseColor({ id: 'p1', kind, name: '' }))).toEqual([
			'#00796b',
			'#475569',
			'#8d6200',
			'#7b1fa2',
			'#6b7280'
		]);
	});

	it('種類的顏色不撞拍子的 down 藍（#1f5fbf）、up 綠（#2b7a2f）', () => {
		const kinds = ['load', 'hold', 'transition', 'dismount', 'whole'] as const;
		const colors = kinds.map((kind) => phaseColor({ id: 'p1', kind, name: '' }));
		expect(colors).not.toContain('#1f5fbf');
		expect(colors).not.toContain('#2b7a2f');
	});

	it('挑了顏色就用挑的', () => {
		expect(phaseColor({ id: 'p1', kind: 'load', name: '', color: '#c62828' })).toBe('#c62828');
	});
});
