// 會清掉紀錄的改動先問：刪動作、段縮短、換大類、組換了人、騰翻跳躍拿掉人、改隊員名字、刪隊員。
import { describe, expect, it } from 'vitest';
import {
	addMembers,
	deleteAction,
	deleteMember,
	markPhaseBeats,
	recordAttempt,
	setSquad,
	squadNumber,
	updateAction,
	updateMember,
	updateSegment,
	type Flow,
	type NewAttempt
} from './index';
import { flowOf, ratedSample, squadNumbers } from '../test-flows';

/** 共用的 ratedSample，x1 的環節挪到前 4 拍（p1 上法 1-1、p2 中段 1-2 到 1-3、p3 下法 1-4），動作變短到 4 拍也切不到。 */
function sample(): Flow {
	let flow = ratedSample();
	for (const [phaseId, at, len] of [['p1', 0, 2], ['p2', 2, 4], ['p3', 6, 2]] as const) {
		flow = flowOf(markPhaseBeats(flow, 'x1', phaseId, at, len));
	}
	return flow;
}

const drill = (who: string, marks: NewAttempt['marks']): NewAttempt => ({
	date: '2026-11-04',
	who,
	practice: 'drill',
	whole: true,
	marks
});

/** x1：t1 第 1 組、t2 第 2 組、t3 第 1 組；x2：t4 小美、t5 小A。 */
function recorded(): Flow {
	let flow = sample();
	flow = flowOf(recordAttempt(flow, 'x1', drill('g1', { p1: '✓' })));
	flow = flowOf(recordAttempt(flow, 'x1', drill('g2', { p1: '✓' })));
	flow = flowOf(recordAttempt(flow, 'x1', drill('g1', { p2: '✗' })));
	flow = flowOf(recordAttempt(flow, 'x2', drill('m1', { p4: '✓' })));
	return flowOf(recordAttempt(flow, 'x2', drill('m2', { p4: '✗' })));
}

const action = (flow: Flow, id: string) => flow.actions.find((a) => a.id === id)!;
const ids = (flow: Flow, id: string) => action(flow, id).successRate!.records.map((r) => r.id);
const x1Members = () => sample().actions[0].members;

describe('沒有紀錄會被動到：不問，跟以前一樣', () => {
	it.each([
		['刪動作', (f: Flow) => deleteAction(f, 'x1')],
		['換大類', (f: Flow) => updateAction(f, 'x1', { category: 'tumbling' })],
		['設組換到別組', (f: Flow) => setSquad(f, 'x1', ['m1'], 2)],
		['騰翻拿掉人', (f: Flow) => updateAction(f, 'x2', { members: [{ memberId: 'm1', role: '騰翻' }] })],
		['改隊員名字', (f: Flow) => updateMember(f, 'm1', { name: '小芳芳' })]
	])('%s', (_, run) => {
		expect(run(sample()).kind).toBe('ok');
	});

	it('有紀錄，但改的事動不到紀錄（換任務角色、改性別、組外的人換組）', () => {
		const flow = recorded();
		const roles = x1Members().map((m) => ({ ...m, role: m.memberId === 'm2' ? '側底' : m.role }));
		expect(updateAction(flow, 'x1', { members: roles }).kind).toBe('ok');
		expect(updateMember(flow, 'm1', { gender: 'M' }).kind).toBe('ok');
		expect(updateMember(flow, 'm1', { name: ' 小美 ' }).kind).toBe('ok');
	});
});

describe('刪動作', () => {
	it('有紀錄：要確認，寫會清掉幾次；確定後刪掉', () => {
		const flow = recorded();
		expect(deleteAction(flow, 'x2')).toEqual({
			kind: 'confirm',
			message: '刪掉動作「騰翻」會清掉 2 次紀錄（紀錄救不回來）',
			items: []
		});
		expect(flowOf(deleteAction(flow, 'x2', { confirmed: true })).actions.map((a) => a.id)).toEqual(['x1']);
	});

	it('段縮短連帶刪動作：確認訊息加上會清掉幾次', () => {
		const r = updateSegment(recorded(), 's1', { eights: 2 });
		expect(r.kind).toBe('confirm');
		expect(r.kind === 'confirm' && r.message).toBe('音樂 1 縮短後，超出段尾的動作裁短到段尾，放不進段裡的刪掉，會一起清掉 2 次紀錄（紀錄救不回來）');
	});

	it('段縮短裁短動作：環節照動作變短的規則切短或刪掉；有紀錄的環節會不見時，確認訊息寫會清掉幾次', () => {
		// 1 拍 = 2 個半拍：x1 裁短成 1 拍，p1（1-1）留著，p2（1-2 到 1-3）、p3（1-4）刪掉；t3 只記了 p2，整次不見。x2 在段外。
		expect(updateSegment(recorded(), 's1', { eights: 1, lastBeats: 1 })).toEqual({
			kind: 'confirm',
			message: '音樂 1 縮短後，超出段尾的動作裁短到段尾，放不進段裡的刪掉，會一起清掉 3 次紀錄（紀錄救不回來）',
			items: ['裁短：動作「技巧·Lib」（1-1 起）8 拍 → 1 拍，會刪掉 2 個環節（清掉 1 次的記號）', '刪掉：動作「騰翻」（3-1 起）']
		});
		const flow = flowOf(updateSegment(recorded(), 's1', { eights: 1, lastBeats: 1 }, { confirmed: true }));
		expect(action(flow, 'x1').successRate!.phases.map((p) => [p.id, p.beats])).toEqual([['p1', { at: 0, len: 2 }]]);
		expect(ids(flow, 'x1')).toEqual(['t1', 't2']);
	});

	it('段縮短裁短動作，切到的環節有記號但那次還有別的記號：確認訊息寫會清掉幾次的記號', () => {
		// 3 拍：p3（1-4）刪掉；那次還記了 p1，紀錄留著
		const flow = flowOf(recordAttempt(sample(), 'x1', drill('g1', { p1: '✓', p3: '✗' })));
		const r = updateSegment(flow, 's1', { eights: 1, lastBeats: 3 });
		expect(r.kind === 'confirm' && r.message).toBe('音樂 1 縮短後，超出段尾的動作裁短到段尾，放不進段裡的刪掉，會清掉 1 次的記號（紀錄救不回來）');
		const after = flowOf(updateSegment(flow, 's1', { eights: 1, lastBeats: 3 }, { confirmed: true }));
		expect(action(after, 'x1').successRate!.records.map((r) => r.marks)).toEqual([{ p1: '✓' }]);
	});

	it('段縮短裁短動作，切到的環節沒有記號：確認訊息不說紀錄', () => {
		// 3 拍：p3（1-4）刪掉，沒有記號
		const r = updateSegment(recorded(), 's1', { eights: 1, lastBeats: 3 });
		expect(r.kind === 'confirm' && r.message).toBe('音樂 1 縮短後，超出段尾的動作裁短到段尾，放不進段裡的刪掉，會一起清掉 2 次紀錄（紀錄救不回來）');
		expect(r.kind === 'confirm' && r.items[0]).toBe('裁短：動作「技巧·Lib」（1-1 起）8 拍 → 3 拍，會刪掉 1 個環節');
	});
});

describe('換大類，算法從一組一起變成每個人自己算（或反過來）', () => {
	it('技巧換成騰翻：要確認，列出每組幾次；確定後清掉紀錄、拿掉組', () => {
		const flow = recorded();
		expect(updateAction(flow, 'x1', { category: 'tumbling' })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換成騰翻，變成每個人自己算，會清掉 3 次紀錄（紀錄救不回來）',
			items: ['第 1 組 小美：2 次', '第 2 組 小芳：1 次']
		});
		const changed = action(flowOf(updateAction(flow, 'x1', { category: 'tumbling' }, { confirmed: true })), 'x1');
		expect(changed.successRate!.records).toEqual([]);
		expect(changed.members.some((m) => 'squad' in m)).toBe(false);
	});

	it('騰翻換成技巧：要確認；確定後清掉紀錄，動作裡的人全部進第 1 組', () => {
		const flow = recorded();
		const r = updateAction(flow, 'x2', { category: 'stunt' });
		expect(r.kind === 'confirm' && r.message).toBe('動作「騰翻」換成技巧，變成一組一起算，會清掉 2 次紀錄（紀錄救不回來）');
		const changed = flowOf(updateAction(flow, 'x2', { category: 'stunt' }, { confirmed: true }));
		expect(ids(changed, 'x2')).toEqual([]);
		expect(squadNumbers(action(changed, 'x2'))).toEqual([1, 1]);
	});

	it('一組一起算的大類之間換（技巧換成金字塔）：不問，紀錄留著', () => {
		expect(ids(flowOf(updateAction(recorded(), 'x1', { category: 'pyramid' })), 'x1')).toEqual(['t1', 't2', 't3']);
	});
});

describe('一組的人變了，而那組有紀錄：保留舊紀錄或清掉重算（紀錄救不回來）', () => {
	it('設組把小美換到第 3 組：問保留還是清掉，列出那組幾次', () => {
		expect(setSquad(recorded(), 'x1', ['m1'], 3)).toEqual({
			kind: 'choose',
			message: '動作「技巧·Lib」有紀錄的組換了人：保留舊紀錄，還是清掉重算？（紀錄救不回來）',
			items: ['第 1 組 小美：2 次']
		});
	});

	it('保留：紀錄留著；清掉：那組的紀錄清掉，別組的不動', () => {
		const flow = recorded();
		expect(ids(flowOf(setSquad(flow, 'x1', ['m1'], 3, { records: 'keep' })), 'x1')).toEqual(['t1', 't2', 't3']);
		expect(ids(flowOf(setSquad(flow, 'x1', ['m1'], 3, { records: 'clear' })), 'x1')).toEqual(['t2']);
	});

	it('小美從第 1 組換到第 2 組：兩組都換了人，清掉就兩組都清', () => {
		const flow = recorded();
		const r = setSquad(flow, 'x1', ['m1'], 2);
		expect(r.kind === 'choose' && r.items).toEqual(['第 1 組 小美：2 次', '第 2 組 小芳：1 次']);
		expect(ids(flowOf(setSquad(flow, 'x1', ['m1'], 2, { records: 'clear' })), 'x1')).toEqual([]);
	});

	it('一次換好幾個人的組：只問一次，列出每個換了人的組', () => {
		const r = setSquad(recorded(), 'x1', ['m1', 'm3'], 3);
		expect(r.kind === 'choose' && r.items).toEqual(['第 1 組 小美：2 次', '第 2 組 小芳：1 次']);
	});

	it('拿掉人（組還有人）：問保留還是清掉', () => {
		const members = x1Members().filter((m) => m.memberId !== 'm2');
		const flow = recorded();
		expect(updateAction(flow, 'x1', { members }).kind).toBe('choose');
		expect(ids(flowOf(updateAction(flow, 'x1', { members }, { records: 'keep' })), 'x1')).toEqual(['t1', 't2', 't3']);
		expect(ids(flowOf(updateAction(flow, 'x1', { members }, { records: 'clear' })), 'x1')).toEqual(['t2']);
	});

	it('加人到有紀錄的組（從別的動作複製人也一樣是換整份人）：問保留還是清掉', () => {
		const flow = flowOf(addMembers(recorded(), [{ name: '小C', gender: 'M', globalRole: 'base' }]));
		const members = [...action(flow, 'x1').members, { memberId: 'm5', role: '側底', squad: 'g2' }];
		expect(updateAction(flow, 'x1', { members }).kind).toBe('choose');
		expect(ids(flowOf(updateAction(flow, 'x1', { members }, { records: 'keep' })), 'x1')).toEqual(['t1', 't2', 't3']);
		expect(ids(flowOf(updateAction(flow, 'x1', { members }, { records: 'clear' })), 'x1')).toEqual(['t1', 't3']);
	});

	it('一組的人全被拿掉：沒得保留，只問會清掉幾次', () => {
		const members = x1Members().filter((m) => m.memberId !== 'm3' && m.memberId !== 'm4');
		const flow = recorded();
		expect(updateAction(flow, 'x1', { members })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換了人，會清掉 1 次紀錄（紀錄救不回來）',
			items: ['第 2 組 小芳：1 次']
		});
		expect(ids(flowOf(updateAction(flow, 'x1', { members }, { confirmed: true })), 'x1')).toEqual(['t1', 't3']);
	});

	it('變短又換了人：拍點和紀錄一起問', () => {
		const members = x1Members().filter((m) => m.memberId !== 'm2');
		const cues = [{ kind: 'count' as const, at: 14, len: 2, word: 'down', who: null }];
		const flow = flowOf(updateAction(recorded(), 'x1', { cues }));
		const r = updateAction(flow, 'x1', { members, length: 8 });
		expect(r.kind).toBe('choose');
		expect(r.kind === 'choose' && r.message).toBe(
			'動作「技巧·Lib」變短，會拿掉 1 個拍點；有紀錄的組換了人：保留舊紀錄，還是清掉重算？（紀錄救不回來）'
		);
		const kept = action(flowOf(updateAction(flow, 'x1', { members, length: 8 }, { records: 'keep' })), 'x1');
		expect(kept.cues).toEqual([]);
		expect(kept.successRate!.records.length).toBe(3);
	});
});

describe('騰翻、跳躍的動作拿掉有紀錄的人', () => {
	it('要確認；確定後清掉他的紀錄', () => {
		const flow = recorded();
		const members = [{ memberId: 'm1', role: '騰翻' }];
		expect(updateAction(flow, 'x2', { members })).toEqual({
			kind: 'confirm',
			message: '動作「騰翻」換了人，會清掉 1 次紀錄（紀錄救不回來）',
			items: ['小A：1 次']
		});
		expect(ids(flowOf(updateAction(flow, 'x2', { members }, { confirmed: true })), 'x2')).toEqual(['t4']);
	});
});

describe('改隊員名字（候補上場），而他有紀錄', () => {
	it('問保留還是清掉，列出他在的組和他自己的紀錄', () => {
		expect(updateMember(recorded(), 'm1', { name: '小芳芳' })).toEqual({
			kind: 'choose',
			message: '小美 改名成「小芳芳」，他在的組和他自己有 3 次紀錄：只是改錯字就保留舊紀錄，換了人就清掉重算（紀錄救不回來）',
			items: ['動作「技巧·Lib」第 1 組 小美：2 次', '動作「騰翻」小美：1 次']
		});
	});

	it('保留：只改名字；清掉：清掉他在的每一組和他自己的紀錄', () => {
		const flow = recorded();
		const kept = flowOf(updateMember(flow, 'm1', { name: '小芳芳' }, { records: 'keep' }));
		expect(kept.members[0].name).toBe('小芳芳');
		expect([ids(kept, 'x1'), ids(kept, 'x2')]).toEqual([['t1', 't2', 't3'], ['t4', 't5']]);
		const cleared = flowOf(updateMember(flow, 'm1', { name: '小芳芳' }, { records: 'clear' }));
		expect(cleared.members[0].name).toBe('小芳芳');
		expect([ids(cleared, 'x1'), ids(cleared, 'x2')]).toEqual([['t2'], ['t5']]);
	});

	it('名字其實沒變（問完之前按了復原）還回答清掉：動作和紀錄都不動', () => {
		const flow = recorded();
		const same = flowOf(updateMember(flow, 'm1', { name: '小美' }, { records: 'clear' }));
		expect(same.actions).toEqual(flow.actions);
	});
});

describe('改隊員名字：他在動作裡沒分組', () => {
	it('只有一組的動作：不算他的紀錄，清掉重算也不會把他放進那一組', () => {
		let flow = flowOf(setSquad(recorded(), 'x1', ['m3', 'm4'], 1, { records: 'keep' }));
		flow = flowOf(setSquad(flow, 'x1', ['m1'], null, { records: 'keep' }));
		const r = updateMember(flow, 'm1', { name: '小芳芳' });
		expect(r.kind === 'choose' && r.items).toEqual(['動作「騰翻」小美：1 次']);
		const cleared = flowOf(updateMember(flow, 'm1', { name: '小芳芳' }, { records: 'clear' }));
		expect(action(cleared, 'x1')).toEqual(action(flow, 'x1'));
	});
});

describe('刪隊員：當成真的換人', () => {
	it('確認訊息加上會清掉幾次紀錄；確定後清掉他在的每一組和他自己的紀錄', () => {
		const flow = recorded();
		const r = deleteMember(flow, 'm2');
		expect(r.kind === 'confirm' && r.message).toBe('刪掉隊員「小A」（標記 2、底層）：他在 2 個動作裡，會清掉 3 次紀錄（紀錄救不回來），「技巧·Lib」第 1 組會沒有主底；後面 2 個人的號碼會往前遞補');
		const after = flowOf(deleteMember(flow, 'm2', { confirmed: true }));
		expect([ids(after, 'x1'), ids(after, 'x2')]).toEqual([['t2'], ['t4']]);
	});

	it('沒有紀錄：不寫紀錄', () => {
		const r = deleteMember(sample(), 'm2');
		expect(r.kind === 'confirm' && r.message).toBe(
			'刪掉隊員「小A」（標記 2、底層）：他在 2 個動作裡，「技巧·Lib」第 1 組會沒有主底；後面 2 個人的號碼會往前遞補'
		);
	});
});

describe('組空掉補號：後面那組往前補號，紀錄還是指到那一組（組 id 不換），還是那群人的', () => {
	/** 每一次：[id, 誰（組 id）, 現在是第幾組]。 */
	const whos = (flow: Flow) => {
		const x1 = action(flow, 'x1');
		return x1.successRate!.records.map((r) => [r.id, r.who, squadNumber(x1, r.who)]);
	};
	/** 每個人：[隊員, 第幾組]。 */
	const squads = (flow: Flow) => {
		const x1 = action(flow, 'x1');
		return x1.members.map((m) => [m.memberId, m.squad && squadNumber(x1, m.squad)]);
	};

	it('拿掉第 1 組的人：第 2 組變第 1 組，紀錄也是', () => {
		const members = x1Members().filter((m) => m.memberId !== 'm1' && m.memberId !== 'm2');
		const flow = flowOf(updateAction(recorded(), 'x1', { members }, { confirmed: true }));
		expect(squads(flow)).toEqual([['m3', 1], ['m4', 1]]);
		expect(whos(flow)).toEqual([['t2', 'g2', 1]]);
	});

	it('設組讓第 1 組空掉：第 2 組補成第 1 組，紀錄跟著換號', () => {
		const flow = flowOf(setSquad(recorded(), 'x1', ['m1'], 3, { records: 'keep' }));
		expect(squads(flow)).toEqual([['m1', 3], ['m2', 1], ['m3', 2], ['m4', 2]]);
		const emptied = flowOf(setSquad(flow, 'x1', ['m2'], 3, { confirmed: true }));
		expect(squads(emptied)).toEqual([['m1', 2], ['m2', 2], ['m3', 1], ['m4', 1]]);
		expect(whos(emptied)).toEqual([['t2', 'g2', 1]]);
	});

	it('刪隊員讓第 1 組空掉：第 2 組補成第 1 組，紀錄跟著換號', () => {
		const members = x1Members().filter((m) => m.memberId !== 'm2');
		let flow = flowOf(updateAction(recorded(), 'x1', { members }, { records: 'keep' }));
		flow = flowOf(deleteMember(flow, 'm1', { confirmed: true }));
		expect(squads(flow)).toEqual([['m3', 1], ['m4', 1]]);
		expect(whos(flow)).toEqual([['t2', 'g2', 1]]);
	});
});
