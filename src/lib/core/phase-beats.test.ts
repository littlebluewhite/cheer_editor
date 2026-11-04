import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	clearPhaseBeats,
	markPhaseBeats,
	moveAction,
	placeCue,
	resizeAction,
	recordAttempt,
	setSquad,
	updateAction,
	updateSegment,
	type ActionCategory,
	type CommandResult,
	type Flow,
	type Phase
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 音樂 s1（4 個八拍）、口號段 s2；隊員小美（上層）、小A。
 * x1：Lib（技巧，1-1 起兩個八拍），兩個人第 1 組。環節：
 * 1-1 到 1-3 上法「延伸」（p1）、1-4 到 2-2 中段（p2）、2-5 到 2-8 下法「搖籃」（p3）。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	flow = flowOf(addSegment(flow, 'chant'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 32, note: '', members }));
	flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'load', name: '延伸' }, 0, 6));
	flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'hold', name: '' }, 6, 14));
	return flowOf(markPhaseBeats(flow, 'x1', { kind: 'dismount', name: '搖籃' }, 24, 8));
}

/** sample 只留 p1（1-1 到 1-3）。 */
const onlyP1 = () => flowOf(clearPhaseBeats(sample(), 'x1', 6, 32));

const lib = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!;
const phasesOf = (flow: Flow): Phase[] => lib(flow).successRate!.phases;
/** 「p1 0+6」：每個環節的 id 和標的拍（沒標拍只寫 id），照清單順序。 */
const brief = (flow: Flow) =>
	phasesOf(flow).map((p) => (p.beats ? `${p.id} ${p.beats.at}+${p.beats.len}` : p.id));
/** 第 1 組記一次，打這些記號。 */
const record = (flow: Flow, marks: Record<string, '✓' | '△' | '✗'>) =>
	flowOf(recordAttempt(flow, 'x1', { date: '2026-11-04', who: 1, practice: 'drill', whole: true, marks }));
/** 動作不記成功率了：沒有成功率設定，也沒有組。 */
const expectUnrated = (flow: Flow) => {
	expect(lib(flow).successRate).toBeUndefined();
	expect(lib(flow).members.map((m) => m.squad)).toEqual([undefined, undefined]);
};

describe('標拍', () => {
	it('標給新的環節：給種類和名字，發新的 id，標上那幾拍，照拍的先後排', () => {
		const r = markPhaseBeats(sample(), 'x1', { kind: 'load', name: ' 起 ' }, 20, 4);
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.id).toBe('p4');
		expect(phasesOf(r.flow)[2]).toEqual({ id: 'p4', kind: 'load', name: '起', beats: { at: 20, len: 4 } });
		expect(brief(r.flow)).toEqual(['p1 0+6', 'p2 6+14', 'p4 20+4', 'p3 24+8']);
	});

	it('標給現有的環節：換掉它原來的拍', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p2' }, 6, 12));
		expect(phasesOf(flow).find((p) => p.id === 'p2')).toEqual({ id: 'p2', kind: 'hold', name: '', beats: { at: 6, len: 12 } });
	});
});

describe('順序', () => {
	it('照拍的先後排', () => {
		expect(brief(sample())).toEqual(['p1 0+6', 'p2 6+14', 'p3 24+8']);
	});

	it('後標的拍比較早：排到前面', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p3' }, 0, 4));
		expect(brief(flow)).toEqual(['p3 0+4', 'p1 4+2', 'p2 6+14']);
	});
});

describe('蓋到別的環節', () => {
	it('被蓋到的部分拿掉：蓋到後面，留前面', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p3' }, 16, 4));
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+10', 'p3 16+4']);
	});

	it('蓋到前面，留後面', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p3' }, 4, 4));
		expect(brief(flow)).toEqual(['p1 0+4', 'p3 4+4', 'p2 8+12']);
	});

	it('從中間切成兩段：留前面那段', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p3' }, 10, 2));
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+4', 'p3 10+2']);
	});

	it('被切短的環節，紀錄留著', () => {
		const flow = flowOf(markPhaseBeats(record(sample(), { p2: '△' }), 'x1', { phaseId: 'p3' }, 16, 4));
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p2: '△' });
	});

	it('整個蓋住：原來那個環節自動刪掉', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { kind: 'whole', name: '' }, 24, 8));
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+14', 'p4 24+8']);
	});

	it('把一個環節的拍全部標給別的環節：原來那個自動刪掉', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p1' }, 0, 20));
		expect(brief(flow)).toEqual(['p1 0+20', 'p3 24+8']);
	});

	it('要刪的環節有記號：先問，說會清掉幾次的記號；確定後刪掉環節和它的記號', () => {
		const recorded = record(sample(), { p1: '✓', p2: '△' });
		expect(markPhaseBeats(recorded, 'x1', { phaseId: 'p2' }, 0, 20)).toEqual({
			kind: 'confirm',
			message: '拍清光的環節會刪掉，清掉 1 次的記號，確定就刪掉',
			items: ['刪掉：環節 上法 延伸']
		});
		const flow = flowOf(markPhaseBeats(recorded, 'x1', { phaseId: 'p2' }, 0, 20, { confirmed: true }));
		expect(brief(flow)).toEqual(['p2 0+20', 'p3 24+8']);
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p2: '△' });
	});
});

describe('標拍擋下來的情況', () => {
	const chant = () => {
		return flowOf(addAction(sample(), { segmentId: 's2', category: 'toss', name: '', start: 0, length: 30, note: '', members: [{ memberId: 'm1', role: '上層' }] }));
	};

	it.each([
		['口號段', chant, 'x2', 0, 2, '口號段不數拍，不能標環節的拍'],
		['不是整拍（半拍長）', sample, 'x1', 0, 3, '環節要佔整數拍，至少 1 拍'],
		['不到一拍', sample, 'x1', 0, 0, '環節要佔整數拍，至少 1 拍'],
		['不在整拍上開始', sample, 'x1', 1, 2, '環節要標在整拍上'],
		['超出動作', sample, 'x1', 30, 4, '環節要在動作裡面'],
		['在動作之前', sample, 'x1', -2, 4, '環節要在動作裡面']
	])('%s', (_, make, id, at, len, message) => {
		expect(markPhaseBeats(make(), id, { kind: 'whole', name: '' }, at, len)).toEqual({ kind: 'blocked', message });
	});

	it('動作被拖半拍後：要對齊音樂的整拍', () => {
		const flow = flowOf(updateAction(onlyP1(), 'x1', { start: 1, length: 30 }));
		expect(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 0, 2)).toEqual({ kind: 'blocked', message: '環節要標在整拍上' });
		expect(brief(flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 1, 2)))).toEqual(['p1 1+2']);
	});
});

describe('沒記成功率的動作標拍加環節', () => {
	/** sample 再加 x2：2-1 起一個八拍、小美和小A，還沒記成功率。 */
	const unrated = (category: ActionCategory) => {
		const members = [
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' }
		];
		return flowOf(addAction(sample(), { segmentId: 's1', category, name: '', start: 32, length: 16, note: '', members }));
	};
	const x2 = (flow: Flow) => flow.actions.find((a) => a.id === 'x2')!;

	it('動作開始記成功率，只有這一個環節', () => {
		const flow = flowOf(markPhaseBeats(unrated('stunt'), 'x2', { kind: 'load', name: '延伸' }, 0, 4));
		expect(x2(flow).successRate).toEqual({
			phases: [{ id: 'p4', kind: 'load', name: '延伸', beats: { at: 0, len: 4 } }],
			records: []
		});
	});

	it.each([
		['stunt', [1, 1]],
		['pyramid', [1, 1]],
		['toss', [1, 1]],
		['dance', [1, 1]],
		['other', [1, 1]],
		['tumbling', [undefined, undefined]],
		['jump', [undefined, undefined]]
	] as const)('%s：分組的大類全部的人進第 1 組；騰翻、跳躍不分組', (category, squads) => {
		const flow = flowOf(markPhaseBeats(unrated(category), 'x2', { kind: 'whole', name: '' }, 0, 4));
		expect(x2(flow).members.map((m) => m.squad)).toEqual(squads);
	});

	it('已經記成功率的動作加環節：組不動', () => {
		const split = flowOf(setSquad(sample(), 'x1', 'm2', 2));
		const flow = flowOf(markPhaseBeats(split, 'x1', { kind: 'whole', name: '' }, 8, 4));
		expect(lib(flow).members.map((m) => m.squad)).toEqual([1, 2]);
	});

	it('還沒有環節，不能標給現有的環節', () => {
		expect(markPhaseBeats(unrated('stunt'), 'x2', { phaseId: 'p1' }, 0, 4)).toEqual({ kind: 'blocked', message: '找不到這個環節' });
	});
});

describe('清標的拍', () => {
	it('只清到一部分：環節變短、還在，紀錄留著', () => {
		let flow = record(sample(), { p3: '✗' });
		flow = flowOf(clearPhaseBeats(flow, 'x1', 16, 28));
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+10', 'p3 28+4']);
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p3: '✗' });
	});

	it('拍清光的環節自動刪掉；沒記號不用問', () => {
		expect(brief(flowOf(clearPhaseBeats(sample(), 'x1', 0, 6)))).toEqual(['p2 6+14', 'p3 24+8']);
		expect(brief(flowOf(clearPhaseBeats(sample(), 'x1', 0, 20)))).toEqual(['p3 24+8']);
	});

	it('要刪的環節有記號：先問；按確定才刪，拿掉它的記號', () => {
		const recorded = record(sample(), { p1: '✓', p2: '△' });
		expect(clearPhaseBeats(recorded, 'x1', 0, 6)).toEqual({
			kind: 'confirm',
			message: '拍清光的環節會刪掉，清掉 1 次的記號，確定就刪掉',
			items: ['刪掉：環節 上法 延伸']
		});
		const flow = flowOf(clearPhaseBeats(recorded, 'x1', 0, 6, { confirmed: true }));
		expect(brief(flow)).toEqual(['p2 6+14', 'p3 24+8']);
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p2: '△' });
	});

	it('刪掉最後一個環節：動作不記成功率了，組一起拿掉', () => {
		expectUnrated(flowOf(clearPhaseBeats(sample(), 'x1', 0, 32)));
	});

	it('刪掉最後一個環節、有紀錄：先問；確定後組和紀錄一起拿掉', () => {
		const recorded = record(record(sample(), { p1: '✓' }), { p3: '✗' });
		expect(clearPhaseBeats(recorded, 'x1', 0, 32)).toEqual({
			kind: 'confirm',
			message: '拍清光的環節會刪掉，清掉 2 次的記號；動作沒有環節了，不再記成功率，確定就刪掉',
			items: ['刪掉：環節 上法 延伸', '刪掉：環節 中段', '刪掉：環節 下法 搖籃']
		});
		expectUnrated(flowOf(clearPhaseBeats(recorded, 'x1', 0, 32, { confirmed: true })));
	});
});

describe('標的拍跟著動作', () => {
	it('拖動作：標的拍從動作開始算，所以跟著走，不問', () => {
		// 150 BPM：一個半拍 0.2 秒；拖到段內第 2 個半拍（1-2）。
		const flow = flowOf(moveAction(sample(), 'x1', 0.4));
		expect(lib(flow).start).toBe(2);
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+14', 'p3 24+8']);
	});

	it('拖到半拍上：標的拍往後對齊整拍；沒切到就不問', () => {
		// 拖到段內第 1 個半拍（1-1&）：標的拍 0+6 會落在 &，往後半拍對齊到 1-2。
		const flow = flowOf(moveAction(onlyP1(), 'x1', 0.2));
		expect(lib(flow).start).toBe(1);
		expect(brief(flow)).toEqual(['p1 1+6']);
	});

	it('拖到半拍上、往後對齊會超出動作：改往前對齊', () => {
		const flow = flowOf(moveAction(flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p1' }, 2, 30)), 'x1', 0.2));
		expect(brief(flow)).toEqual(['p1 1+30']);
	});

	it('拖到半拍上、往前往後都會切到：先問；確定後往後對齊、切短最後那個環節', () => {
		expect(moveAction(sample(), 'x1', 0.2)).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」拖到半拍上，會切短 1 個環節標的拍',
			items: ['切短：環節 下法 搖籃 2-5 到 2-8 → 2-6 到 2-8']
		});
		const flow = flowOf(moveAction(sample(), 'x1', 0.2, { confirmed: true }));
		expect(brief(flow)).toEqual(['p1 1+6', 'p2 7+14', 'p3 25+6']);
	});

	it('拖到半拍上、對齊後不到一拍：那個環節刪掉（先問）', () => {
		// 一拍長的動作只有一個一拍的環節：拖到 & 上，往前往後對齊都會跑出動作。
		const short = flowOf(updateAction(onlyP1(), 'x1', { length: 2 }, { confirmed: true }));
		expect(moveAction(short, 'x1', 0.2)).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」拖到半拍上，會刪掉 1 個環節，動作不再記成功率',
			items: ['刪掉：環節 上法 延伸 1-1']
		});
		expectUnrated(flowOf(moveAction(short, 'x1', 0.2, { confirmed: true })));
	});

	it('改 BPM：標的拍還在同一拍', () => {
		const flow = flowOf(updateSegment(sample(), 's1', { bpm: 120 }));
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+14', 'p3 24+8']);
	});

	it('動作變短、切到標的拍：先問，列出切短和刪掉的環節，流程不變', () => {
		expect(updateAction(sample(), 'x1', { length: 18 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會切短 1 個環節標的拍、刪掉 1 個環節',
			items: ['切短：環節 中段 1-4 到 2-2 → 1-4 到 2-1', '刪掉：環節 下法 搖籃 2-5 到 2-8']
		});
	});

	it('刪掉的環節有記號：訊息寫會清掉幾次的記號；按確定才刪、記號一起拿掉', () => {
		const recorded = record(record(sample(), { p3: '✓' }), { p1: '✓', p3: '✗' });
		expect(updateAction(recorded, 'x1', { length: 19 })).toMatchObject({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會切短 1 個環節標的拍、刪掉 1 個環節（清掉 2 次的記號）'
		});
		const flow = flowOf(updateAction(recorded, 'x1', { length: 19 }, { confirmed: true }));
		expect(lib(flow).length).toBe(19);
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+12']);
		expect(lib(flow).successRate!.records.map((r) => r.marks)).toEqual([{ p1: '✓' }]);
	});

	it('變短刪掉最後一個環節：動作不記成功率了', () => {
		expect(updateAction(onlyP1(), 'x1', { length: 1 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會刪掉 1 個環節，動作不再記成功率',
			items: ['刪掉：環節 上法 延伸 1-1 到 1-3']
		});
		expectUnrated(flowOf(updateAction(onlyP1(), 'x1', { length: 1 }, { confirmed: true })));
	});

	it('跟拍點一起問：一個訊息、一張清單', () => {
		const cued = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 28, len: 4, word: 'down' }));
		expect(updateAction(cued, 'x1', { length: 24 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會拿掉 1 個拍點，刪掉 1 個環節',
			items: ['拿掉：拍子 down 2-7 到 2-8', '刪掉：環節 下法 搖籃 2-5 到 2-8']
		});
	});

	it('拉色條變短也一樣：先問，沒按確定就不動', () => {
		// 拉到段內第 24 個半拍（4.8 秒）。
		const r = resizeAction(sample(), 'x1', 4.8);
		expect(r).toMatchObject({ kind: 'confirm', items: ['刪掉：環節 下法 搖籃 2-5 到 2-8'] });
		const flow = flowOf(resizeAction(sample(), 'x1', 4.8, { confirmed: true }));
		expect(brief(flow)).toEqual(['p1 0+6', 'p2 6+14']);
	});

	it('動作變短但沒切到標的拍：不問', () => {
		expect(brief(flowOf(updateAction(onlyP1(), 'x1', { length: 6 })))).toEqual(['p1 0+6']);
	});

	it('換到口號段：先問；確定後標的拍全部拿掉，環節留著', () => {
		expect(updateAction(sample(), 'x1', { segmentId: 's2', start: 0, length: 30 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換到口號段，會讓 3 個環節變沒標拍',
			items: [
				'變沒標拍：環節 上法 延伸 1-1 到 1-3',
				'變沒標拍：環節 中段 1-4 到 2-2',
				'變沒標拍：環節 下法 搖籃 2-5 到 2-8'
			]
		});
		const flow = flowOf(updateAction(sample(), 'x1', { segmentId: 's2', start: 0, length: 30 }, { confirmed: true }));
		expect(brief(flow)).toEqual(['p1', 'p2', 'p3']);
	});

	it('從口號段換回音樂段：沒拍的環節刪掉（先問），刪光就不記成功率', () => {
		const chant = flowOf(updateAction(onlyP1(), 'x1', { segmentId: 's2', start: 0, length: 30 }, { confirmed: true }));
		expect(updateAction(chant, 'x1', { segmentId: 's1', start: 0, length: 32 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換到音樂段，會刪掉 1 個環節，動作不再記成功率',
			items: ['刪掉：環節 上法 延伸']
		});
		expectUnrated(flowOf(updateAction(chant, 'x1', { segmentId: 's1', start: 0, length: 32 }, { confirmed: true })));
	});
});

describe('不動拍點', () => {
	it('標拍、清標的拍，拍點都不變；拍點可以超出環節', () => {
		const cues = flowOf(placeCue(sample(), 'x1', { kind: 'step', at: 4, len: 6, word: '上' }));
		const before = lib(cues).cues;
		let flow = flowOf(markPhaseBeats(cues, 'x1', { kind: 'load', name: '延伸' }, 0, 6));
		expect(lib(flow).cues).toEqual(before);
		flow = flowOf(clearPhaseBeats(flow, 'x1', 0, 32));
		expect(lib(flow).cues).toEqual(before);
	});
});
