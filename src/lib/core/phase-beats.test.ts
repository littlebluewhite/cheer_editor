import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addPhase,
	addSegment,
	createFlow,
	clearPhaseBeats,
	enableSuccessRate,
	markPhaseBeats,
	moveAction,
	phaseSpan,
	placeCue,
	resizeAction,
	recordAttempt,
	setSquad,
	updateAction,
	updateSegment,
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
 * x1：Lib（技巧，1-1 起兩個八拍），記成功率（p1 上法、p2 中段、p3 下法，都沒標拍）；兩個人第 1 組。
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
	flow = flowOf(enableSuccessRate(flow, 'x1'));
	flow = flowOf(setSquad(flow, 'x1', 'm1', 1));
	return flowOf(setSquad(flow, 'x1', 'm2', 1));
}

const lib = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!;
const phasesOf = (flow: Flow): Phase[] => lib(flow).successRate!.phases;
/** 「p1 0+6」：每個環節的 id 和標的拍（沒標拍只寫 id），照清單順序。 */
const brief = (flow: Flow) =>
	phasesOf(flow).map((p) => (p.beats ? `${p.id} ${p.beats.at}+${p.beats.len}` : p.id));

describe('標拍', () => {
	it('標給新的環節：給種類和名字，發新的 id，標上那幾拍', () => {
		const r = markPhaseBeats(sample(), 'x1', { kind: 'load', name: ' 延伸 ' }, 0, 6);
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.id).toBe('p4');
		expect(phasesOf(r.flow)[0]).toEqual({ id: 'p4', kind: 'load', name: '延伸', beats: { at: 0, len: 6 } });
	});

	it('標給現有的環節：換掉它原來的拍', () => {
		let flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p2' }, 6, 4));
		flow = flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p2' }, 6, 12));
		expect(phasesOf(flow).find((p) => p.id === 'p2')).toEqual({ id: 'p2', kind: 'hold', name: '', beats: { at: 6, len: 12 } });
	});
});

/** 例子：1-1 到 1-3 新的上法「延伸」（p4）、1-4 到 2-2 標給中段 p2、2-5 到 2-8 新的下法「搖籃」（p5）。 */
function example(): Flow {
	let flow = flowOf(markPhaseBeats(sample(), 'x1', { kind: 'load', name: '延伸' }, 0, 6));
	flow = flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p2' }, 6, 14));
	return flowOf(markPhaseBeats(flow, 'x1', { kind: 'dismount', name: '搖籃' }, 24, 8));
}

describe('順序', () => {
	it('標了拍的照時間排在前面；沒標的排在後面，照原來的順序', () => {
		expect(brief(example())).toEqual(['p4 0+6', 'p2 6+14', 'p5 24+8', 'p1', 'p3']);
	});

	it('後標的拍比較早：排到前面', () => {
		const flow = flowOf(markPhaseBeats(example(), 'x1', { phaseId: 'p1' }, 20, 4));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+14', 'p1 20+4', 'p5 24+8', 'p3']);
	});
});

describe('蓋到別的環節', () => {
	it('被蓋到的部分拿掉：蓋到後面，留前面', () => {
		const flow = flowOf(markPhaseBeats(example(), 'x1', { phaseId: 'p1' }, 16, 4));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+10', 'p1 16+4', 'p5 24+8', 'p3']);
	});

	it('蓋到前面，留後面', () => {
		const flow = flowOf(markPhaseBeats(example(), 'x1', { phaseId: 'p1' }, 4, 4));
		expect(brief(flow)).toEqual(['p4 0+4', 'p1 4+4', 'p2 8+12', 'p5 24+8', 'p3']);
	});

	it('從中間切成兩段：留前面那段', () => {
		const flow = flowOf(markPhaseBeats(example(), 'x1', { phaseId: 'p1' }, 10, 2));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+4', 'p1 10+2', 'p5 24+8', 'p3']);
	});

	it('剩不到一拍：變沒標拍，環節本身還在（排到沒標的那裡，照原來的先後）', () => {
		const moved = flowOf(markPhaseBeats(example(), 'x1', { phaseId: 'p4' }, 0, 4));
		// p4 標 1-1 到 1-2，再把 1-2 到 2-2 標給 p1：p4 只剩 1-1 一拍；再蓋掉 1-1 就變沒標拍。
		let flow = flowOf(markPhaseBeats(moved, 'x1', { phaseId: 'p1' }, 2, 18));
		expect(brief(flow)).toEqual(['p4 0+2', 'p1 2+18', 'p5 24+8', 'p2', 'p3']);
		flow = flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 0, 20));
		expect(brief(flow)).toEqual(['p1 0+20', 'p5 24+8', 'p4', 'p2', 'p3']);
	});

	it('整個蓋住：變沒標拍', () => {
		const flow = flowOf(markPhaseBeats(example(), 'x1', { kind: 'whole', name: '' }, 24, 8));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+14', 'p6 24+8', 'p5', 'p1', 'p3']);
	});

	it('被切短、變沒標拍的環節，紀錄都留著', () => {
		const attempt = { date: '2026-11-04', who: 1, practice: 'drill', whole: true, marks: { p4: '✓', p2: '△' } } as const;
		let flow = flowOf(recordAttempt(example(), 'x1', attempt));
		flow = flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 0, 8));
		expect(brief(flow)).toEqual(['p1 0+8', 'p2 8+12', 'p5 24+8', 'p4', 'p3']);
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p4: '✓', p2: '△' });
	});
});

describe('標拍擋下來的情況', () => {
	const chant = () => {
		const flow = flowOf(addAction(sample(), { segmentId: 's2', category: 'toss', name: '', start: 0, length: 30, note: '', members: [{ memberId: 'm1', role: '上層' }] }));
		return flowOf(enableSuccessRate(flow, 'x2'));
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

	it('沒打開記成功率', () => {
		const flow = flowOf(addAction(sample(), { segmentId: 's1', category: 'jump', name: '', start: 32, length: 16, note: '', members: [{ memberId: 'm1', role: null }] }));
		expect(markPhaseBeats(flow, 'x2', { kind: 'whole', name: '' }, 0, 2)).toEqual({ kind: 'blocked', message: '先打開記成功率才能標拍' });
	});

	it('動作被拖半拍後：要對齊音樂的整拍', () => {
		const flow = flowOf(updateAction(sample(), 'x1', { start: 1, length: 30 }));
		expect(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 0, 2)).toEqual({ kind: 'blocked', message: '環節要標在整拍上' });
		expect(brief(flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 1, 2)))).toEqual(['p1 1+2', 'p2', 'p3']);
	});
});

describe('清標的拍', () => {
	it('拿掉那段拍裡的標的拍，被切到的切短；環節和紀錄留著', () => {
		const attempt = { date: '2026-11-04', who: 1, practice: 'drill', whole: true, marks: { p5: '✗' } } as const;
		let flow = flowOf(recordAttempt(example(), 'x1', attempt));
		flow = flowOf(clearPhaseBeats(flow, 'x1', 16, 28));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+10', 'p5 28+4', 'p1', 'p3']);
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p5: '✗' });
	});

	it('整個清掉：變沒標拍', () => {
		const flow = flowOf(clearPhaseBeats(example(), 'x1', 0, 32));
		expect(brief(flow)).toEqual(['p4', 'p2', 'p5', 'p1', 'p3']);
	});
});

describe('標的拍跟著動作', () => {
	it('拖動作：標的拍從動作開始算，所以跟著走，不問', () => {
		// 150 BPM：一個半拍 0.2 秒；拖到段內第 2 個半拍（1-2）。
		const flow = flowOf(moveAction(example(), 'x1', 0.4));
		expect(lib(flow).start).toBe(2);
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+14', 'p5 24+8', 'p1', 'p3']);
	});

	it('拖到半拍上：標的拍往後對齊整拍；沒切到就不問', () => {
		// 拖到段內第 1 個半拍（1-1&）：標的拍 0+6 會落在 &，往後半拍對齊到 1-2。
		const flow = flowOf(moveAction(flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p1' }, 0, 6)), 'x1', 0.2));
		expect(lib(flow).start).toBe(1);
		expect(brief(flow)).toEqual(['p1 1+6', 'p2', 'p3']);
	});

	it('拖到半拍上、往後對齊會超出動作：改往前對齊', () => {
		const flow = flowOf(moveAction(flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p1' }, 2, 30)), 'x1', 0.2));
		expect(brief(flow)).toEqual(['p1 1+30', 'p2', 'p3']);
	});

	it('拖到半拍上、往前往後都會切到：先問；確定後往後對齊、切短最後那個環節', () => {
		expect(moveAction(example(), 'x1', 0.2)).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」拖到半拍上，會切短 1 個環節標的拍',
			items: ['切短：環節 下法 搖籃 2-5 到 2-8 → 2-6 到 2-8']
		});
		const flow = flowOf(moveAction(example(), 'x1', 0.2, { confirmed: true }));
		expect(brief(flow)).toEqual(['p4 1+6', 'p2 7+14', 'p5 25+6', 'p1', 'p3']);
	});

	it('改 BPM：標的拍還在同一拍', () => {
		const flow = flowOf(updateSegment(example(), 's1', { bpm: 120 }));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+14', 'p5 24+8', 'p1', 'p3']);
	});

	it('動作變短、切到標的拍：先問，列出切短和變沒標拍的環節，流程不變', () => {
		expect(updateAction(example(), 'x1', { length: 18 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會切短 1 個環節標的拍、讓 1 個環節變沒標拍',
			items: ['切短：環節 中段 1-4 到 2-2 → 1-4 到 2-1', '變沒標拍：環節 下法 搖籃 2-5 到 2-8']
		});
	});

	it('按確定：切短，不到一拍的變沒標拍（環節和紀錄留著）', () => {
		const attempt = { date: '2026-11-04', who: 1, practice: 'drill', whole: true, marks: { p5: '✓' } } as const;
		const recorded = flowOf(recordAttempt(example(), 'x1', attempt));
		const flow = flowOf(updateAction(recorded, 'x1', { length: 19 }, { confirmed: true }));
		expect(lib(flow).length).toBe(19);
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+12', 'p5', 'p1', 'p3']);
		expect(lib(flow).successRate!.records[0].marks).toEqual({ p5: '✓' });
	});

	it('跟拍點一起問：一個訊息、一張清單', () => {
		const cued = flowOf(placeCue(example(), 'x1', { kind: 'count', at: 28, len: 4, word: 'down' }));
		expect(updateAction(cued, 'x1', { length: 24 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」變短，會拿掉 1 個拍點，讓 1 個環節變沒標拍',
			items: ['拿掉：拍子 down 2-7 到 2-8', '變沒標拍：環節 下法 搖籃 2-5 到 2-8']
		});
	});

	it('拉色條變短也一樣：先問，沒按確定就不動', () => {
		// 拉到段內第 24 個半拍（4.8 秒）。
		const r = resizeAction(example(), 'x1', 4.8);
		expect(r).toMatchObject({ kind: 'confirm', items: ['變沒標拍：環節 下法 搖籃 2-5 到 2-8'] });
		const flow = flowOf(resizeAction(example(), 'x1', 4.8, { confirmed: true }));
		expect(brief(flow)).toEqual(['p4 0+6', 'p2 6+14', 'p5', 'p1', 'p3']);
	});

	it('動作變短但沒切到標的拍：不問', () => {
		const flow = flowOf(markPhaseBeats(sample(), 'x1', { phaseId: 'p1' }, 0, 6));
		expect(brief(flowOf(updateAction(flow, 'x1', { length: 6 })))).toEqual(['p1 0+6', 'p2', 'p3']);
	});

	it('換到口號段：先問；確定後標的拍全部拿掉，環節留著', () => {
		expect(updateAction(example(), 'x1', { segmentId: 's2', start: 0, length: 30 })).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」換到口號段，會讓 3 個環節變沒標拍',
			items: [
				'變沒標拍：環節 上法 延伸 1-1 到 1-3',
				'變沒標拍：環節 中段 1-4 到 2-2',
				'變沒標拍：環節 下法 搖籃 2-5 到 2-8'
			]
		});
		const flow = flowOf(updateAction(example(), 'x1', { segmentId: 's2', start: 0, length: 30 }, { confirmed: true }));
		expect(brief(flow)).toEqual(['p4', 'p2', 'p5', 'p1', 'p3']);
	});

	it('沒有標的拍時換到口號段：不問', () => {
		const flow = flowOf(updateAction(sample(), 'x1', { segmentId: 's2', start: 0, length: 30 }));
		expect(brief(flow)).toEqual(['p1', 'p2', 'p3']);
	});
});

describe('環節的範圍和裡面的拍點', () => {
	it('範圍照八拍寫；碰到範圍的拍點都算（拍點可以超出環節）；沒標拍是 null', () => {
		let flow = flowOf(placeCue(example(), 'x1', { kind: 'step', at: 4, len: 6, word: '上' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 26, len: 2, word: 'high V' }));
		const span = (id: string) => {
			const s = phaseSpan(flow, lib(flow), phasesOf(flow).find((p) => p.id === id)!);
			return s && { range: s.range, cues: s.cues.map((c) => c.word) };
		};
		expect(span('p4')).toEqual({ range: '1-1 到 1-3', cues: ['down', '上'] });
		expect(span('p2')).toEqual({ range: '1-4 到 2-2', cues: ['上'] });
		expect(span('p5')).toEqual({ range: '2-5 到 2-8', cues: ['high V'] });
		expect(span('p1')).toBeNull();
	});
});

describe('不動拍點', () => {
	it('標拍、清標的拍、加環節，拍點都不變；拍點可以超出環節', () => {
		const cues = flowOf(placeCue(sample(), 'x1', { kind: 'step', at: 4, len: 6, word: '上' }));
		const before = lib(cues).cues;
		let flow = flowOf(markPhaseBeats(cues, 'x1', { kind: 'load', name: '延伸' }, 0, 6));
		expect(lib(flow).cues).toEqual(before);
		flow = flowOf(clearPhaseBeats(flow, 'x1', 0, 32));
		expect(lib(flow).cues).toEqual(before);
		flow = flowOf(addPhase(flow, 'x1', { kind: 'whole', name: '' }));
		expect(lib(flow).cues).toEqual(before);
	});
});
