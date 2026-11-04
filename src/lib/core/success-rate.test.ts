import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	clearPhaseBeats,
	attemptWhos,
	addPhase,
	phaseColor,
	setSquad,
	squadName,
	squadsOf,
	updateAction,
	updateSegment,
	type ActionCategory,
	type Flow
} from './index';
import { flowOf, squadNumbers } from '../test-flows';

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

/** x1 加一個整個動作的環節（開始記成功率；分組的大類全部的人先進第 1 組）。 */
const rated = (flow: Flow, id = 'x1') => flowOf(addPhase(flow, id, { kind: 'whole', name: '', beats: { at: 0, len: 16 } }));

describe('環節的 id', () => {
	it('刪掉的環節的 id 不重用：清光再加，是新的 id', () => {
		let flow = flowOf(clearPhaseBeats(rated(sample()), 'x1', 0, 16));
		expect(actionOf(flow).successRate).toBeUndefined();
		flow = rated(flow);
		expect(actionOf(flow).successRate?.phases.map((p) => p.id)).toEqual(['p2']);
	});
});

describe('設組', () => {
	const on = (category: ActionCategory = 'stunt') => rated(sample(category));
	const squads = (flow: Flow) => squadNumbers(actionOf(flow));

	it('給隊員第幾組；給 null 就是沒分組', () => {
		let flow = flowOf(setSquad(on(), 'x1', ['m1'], 1));
		flow = flowOf(setSquad(flow, 'x1', ['m2'], 2));
		expect(squads(flow)).toEqual([1, 2, 1, 1]);
		flow = flowOf(setSquad(flow, 'x1', ['m1'], null));
		expect(squads(flow)).toEqual([undefined, 2, 1, 1]);
		expect('squad' in actionOf(flow).members[0]).toBe(false);
	});

	it.each([
		['tumbling', '騰翻'],
		['jump', '跳躍']
	] as const)('%s 的動作不分組，擋下來並說原因', (category, label) => {
		expect(setSquad(on(category), 'x1', ['m1'], 1)).toEqual({
			kind: 'blocked',
			message: `${label}的動作不分組，每個人自己算`
		});
	});

	it('沒有環節不能分組', () => {
		expect(setSquad(sample(), 'x1', ['m1'], 1)).toEqual({ kind: 'blocked', message: '動作有環節才能分組' });
	});

	it.each([0, -1, 1.5])('組要是正整數（%s 被擋）', (squad) => {
		expect(setSquad(on(), 'x1', ['m1'], squad)).toEqual({ kind: 'blocked', message: '組要是正整數' });
	});

	it('一次給好幾個人同一組（一個指令，復原一步）', () => {
		const flow = flowOf(setSquad(on(), 'x1', ['m2', 'm3'], 2));
		expect(squads(flow)).toEqual([1, 2, 2, 1]);
		expect(squads(flowOf(setSquad(flow, 'x1', ['m1', 'm2'], null)))).toEqual([undefined, undefined, 2, 1]);
	});

	it('一次給好幾個人：有一個不在動作裡就整個擋下來', () => {
		expect(setSquad(on(), 'x1', ['m2', 'm9'], 2)).toEqual({ kind: 'blocked', message: '這個隊員不在動作裡' });
	});

	it('組空掉了，後面的組往前補號', () => {
		let flow = flowOf(setSquad(on(), 'x1', ['m2'], 2));
		flow = flowOf(setSquad(flow, 'x1', ['m3'], 3));
		expect(squads(flow)).toEqual([1, 2, 3, 1]);
		flow = flowOf(setSquad(flow, 'x1', ['m2'], 1));
		expect(squads(flow)).toEqual([1, 1, 2, 1]);
	});

	it('給的組號跳號，補成下一組', () => {
		const flow = flowOf(setSquad(on(), 'x1', ['m2'], 16));
		expect(squads(flow)).toEqual([1, 2, 1, 1]);
	});

	it('隊員不在動作裡被擋', () => {
		const flow = flowOf(
			addMembers(on(), [{ name: '小D', gender: 'F', globalRole: 'top' }])
		);
		expect(setSquad(flow, 'x1', ['m5'], 1)).toEqual({ kind: 'blocked', message: '這個隊員不在動作裡' });
	});
});

describe('組的名字', () => {
	/** x1 加一個環節（全部的人先進第 1 組），再照給的 [隊員, 第幾組] 分組。 */
	function grouped(pairs: [string, number][], flow = sample()): Flow {
		flow = rated(flow);
		for (const [memberId, squad] of pairs) flow = flowOf(setSquad(flow, 'x1', [memberId], squad));
		return flow;
	}
	/** 第 n 組的組 id。 */
	const nth = (flow: Flow, n: number) => squadsOf(actionOf(flow))[n - 1];

	it('第 n 組加上組裡任務角色是上層的人', () => {
		const flow = grouped([['m1', 1], ['m2', 1], ['m3', 1]]);
		expect(squadName(flow, actionOf(flow), nth(flow, 1))).toBe('第 1 組 小美');
	});

	it('好幾個上層：用名單上第一個（不是動作裡的順序）', () => {
		let flow = sample();
		const reversed = actionOf(flow).members.toReversed();
		flow = flowOf(updateAction(flow, 'x1', { members: reversed }));
		flow = grouped([['m4', 2], ['m1', 2]], flow);
		expect(actionOf(flow).members[0].memberId).toBe('m4');
		expect(squadName(flow, actionOf(flow), nth(flow, 2))).toBe('第 2 組 小美');
	});

	it('沒有上層就只叫第 n 組', () => {
		const flow = grouped([['m2', 3], ['m3', 3]]);
		expect(squadName(flow, actionOf(flow), nth(flow, 3))).toBe('第 3 組');
	});
});

describe('開始分組：動作裡的人全部進第 1 組', () => {
	it('有一個環節的騰翻（四個人）換成技巧並帶「確定」：每個人在第 1 組，記錄頁的「誰」是一組', () => {
		const flow = flowOf(updateAction(rated(sample('tumbling')), 'x1', { category: 'stunt' }, { confirmed: true }));
		expect(squadNumbers(actionOf(flow))).toEqual([1, 1, 1, 1]);
		expect(attemptWhos(flow, actionOf(flow))).toEqual([{ who: 'g1', name: '第 1 組 小美' }]);
	});
});

describe('組跟著改動作', () => {
	/** x1 有環節、分成兩組（小美、小A 第 1 組；小B、小芳 第 2 組）；x2 是後面的另一個動作（大類照給的），只有小美，on 就加一個環節。 */
	function twoActions(category: ActionCategory, on: boolean): Flow {
		let flow = rated(sample());
		for (const [memberId, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
			flow = flowOf(setSquad(flow, 'x1', [memberId], squad));
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
		return on ? rated(flow, 'x2') : flow;
	}
	const copyPeople = (flow: Flow) =>
		flowOf(updateAction(flow, 'x2', { members: actionOf(flow, 'x1').members.map((m) => ({ ...m })) }));
	const squads = (flow: Flow, id: string) => squadNumbers(actionOf(flow, id));

	describe('加人：動作只有一組就進第 1 組，好幾組就先沒有組', () => {
		/** x2 加小A 進來，沒帶組（「＋加人…」只送人，組由核心決定）。 */
		const addOne = (flow: Flow) => {
			const members = [...actionOf(flow, 'x2').members, { memberId: 'm2', role: null }];
			return flowOf(updateAction(flow, 'x2', { members }));
		};

		it('只有一組：新的人在第 1 組', () => {
			expect(squads(addOne(twoActions('stunt', true)), 'x2')).toEqual([1, 1]);
		});

		it('好幾組：新的人沒有組', () => {
			let flow = twoActions('stunt', true);
			// 小B 從 x1 帶著第 2 組進來：x2 沒有第 2 組，是新的一組。
			const members = [...actionOf(flow, 'x2').members, { ...actionOf(flow, 'x1').members[2] }];
			flow = flowOf(updateAction(flow, 'x2', { members }));
			expect(squads(addOne(flow), 'x2')).toEqual([1, 2, undefined]);
		});

		it('沒有環節、騰翻跳躍：新的人沒有組', () => {
			expect(squads(addOne(twoActions('stunt', false)), 'x2')).toEqual([undefined, undefined]);
			expect(squads(addOne(twoActions('jump', true)), 'x2')).toEqual([undefined, undefined]);

		});
	});

	it('從別的動作複製人：連組一起帶，照號碼對，兩個動作不共用組 id', () => {
		const before = twoActions('stunt', true);
		const flow = copyPeople(before);
		expect(squads(flow, 'x2')).toEqual([1, 1, 2, 2]);
		// x2 本來的第 1 組留著，第 2 組是新發的組 id。
		expect(squadsOf(actionOf(flow, 'x2'))[0]).toBe(squadsOf(actionOf(before, 'x2'))[0]);
		const x1 = squadsOf(actionOf(flow, 'x1'));
		expect(squadsOf(actionOf(flow, 'x2')).some((id) => x1.includes(id))).toBe(false);
	});

	it('從別的動作複製人到還沒有組的動作：每一組都是新的組 id', () => {
		let flow = twoActions('stunt', true);
		flow = flowOf(setSquad(flow, 'x2', ['m1'], null));
		flow = copyPeople(flow);
		expect(squads(flow, 'x2')).toEqual([1, 1, 2, 2]);
		const x1 = squadsOf(actionOf(flow, 'x1'));
		expect(squadsOf(actionOf(flow, 'x2')).some((id) => x1.includes(id))).toBe(false);
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

	it('組 id 不對被擋', () => {
		const flow = twoActions('stunt', true);
		const members = [{ memberId: 'm1', role: null, squad: '1' }];
		expect(updateAction(flow, 'x2', { members })).toEqual({ kind: 'blocked', message: '組的 id 不對' });
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
