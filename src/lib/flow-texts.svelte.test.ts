// 流程核心給畫面的字（八拍表、影片、站位、拍點、成功率）照語言寫：英文畫面看不到中文（ADR 0017）。
// 隊員、動作、站位的名字用英文，教練自己取的名字才不算。
import { beforeEach, describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import {
	CUE_KIND_LABELS,
	MARKS,
	NOT_YET_TITLE,
	addAction,
	addMembers,
	addPhase,
	addSegment,
	attemptWhos,
	createFlow,
	cueWhy,
	cueWordWhy,
	eightCountRows,
	formationNowWhy,
	formationWalks,
	insertFormation,
	memberNowWhy,
	moveFormationHint,
	moveTargetWhy,
	placeCue,
	renameFormation,
	setPositions,
	squadWhy,
	updateAction,
	updateSegment,
	videoFrames,
	videoRows,
	walkSpeedWhy,
	type Flow,
	type WhyParam
} from '#lib/core';
import { flowOf } from './test-flows';
import { reasonText, whyText } from './reason-text';

/** 音樂 1（2 個整八拍 ＋ 4 拍）→ 口號 1（10 秒）；Lib 有環節（分組）和拍點，騰翻全隊做到第 3 個八拍，站位 2 有人走過去。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: 'Amy', gender: 'F', globalRole: 'top' },
			{ name: 'Bob', gender: 'M', globalRole: 'base' },
			{ name: 'Cal', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 3, lastBeats: 4 }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	const lib = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members: lib }));
	const all = ['m1', 'm2', 'm3'].map((memberId) => ({ memberId, role: '騰翻' }));
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 16, length: 24, note: '', members: all }));
	const team = ['m1', 'm2', 'm3'].map((memberId) => ({ memberId, role: null }));
	flow = flowOf(addAction(flow, { segmentId: 's2', category: 'dance', name: '', start: 0, length: 20, note: '', members: team }));
	flow = flowOf(addPhase(flow, 'x1', { kind: 'load', name: '', beats: { at: 0, len: 8 } }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 8, len: 4, word: '落地', who: { role: '上層' } }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 12, len: 2, word: '雙手並攏' }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 14, len: 2, word: 'down' }));
	flow = flowOf(insertFormation(flow, 6.4));
	flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
	return flowOf(renameFormation(flow, flow.formations[1].id, 'Pyramid'));
}

const HAN = /\p{Script=Han}/u;

/** 每一個字都寫成英文了：沒有中文，也沒有沒寫成字的代號。 */
function expectEnglish(texts: WhyParam[]) {
	for (const t of texts.map(whyText)) {
		expect(t, t).not.toMatch(HAN);
		expect(t).not.toContain('[object Object]');
	}
}

describe('流程核心給畫面的字：英文', () => {
	beforeEach(() => localStorage.setItem(localStorageKey, 'en'));

	it('八拍表（全隊和個人表）每一格的字都是英文', () => {
		const flow = sample();
		for (const memberId of [null, 'm1', 'm2']) {
			const rows = eightCountRows(flow, memberId);
			expectEnglish(
				rows.flatMap((r) => [
					r.segmentWhy,
					r.eightText,
					...r.actions.flatMap((a) => [a.at, a.who]),
					...r.continuing,
					...r.formations.flatMap((f) => [f.at, f.caption]),
					...r.walks,
					...r.cues.flatMap((l) => [
						...l.phases.map((p) => p.label),
						...l.cues.flatMap((c) => [c.span, c.who ?? '', cueWordWhy(c.kind, c.word), cueWhy(c.kind, c.word, c.span, c.who ?? '')])
					]),
					...r.lanes.map((l) => l.role)
				])
			);
		}
		const [first, second, third] = eightCountRows(flow, null);
		expect(whyText(first.actions[0].who)).toBe('Amy (Top person), Bob (Primary base)');
		expect(whyText(second.actions[0].who)).toBe('Whole team: Amy (Tumbler), Bob (Tumbler), Cal (Tumbler)');
		expect(whyText(third.formations[0].caption)).toBe('Formation 2 Pyramid · 3-1 (depart 2-1)');
		expect(third.continuing.map(whyText)).toEqual(['Tumbling']);
		const cue = first.cues[0].cues.find((c) => c.kind === 'step')!;
		expect(whyText(cueWhy(cue.kind, cue.word, cue.span, cue.who ?? ''))).toBe('Step land 1-5 to 1-6 · 2 beats · for Top person');
		const chant = eightCountRows(flow, null).at(-1)!;
		expect(whyText(chant.eightText)).toBe('Whole segment, 10.0 s');
		expect(whyText(chant.actions[0].at)).toBe('0.0 to 2.0 s · 2.0 s');
		expect(whyText(chant.actions[0].who)).toBe('Whole team');
		expect(whyText(eightCountRows(flow, 'm2')[0].actions[0].who)).toBe('Primary base · Stunt group 1 · Same stunt group: Amy (Top person)');
		expect(whyText(eightCountRows(flow, 'm1')[1].walks[0])).toBe('Depart 2-1 → formation 2 (arrive 3-1)');
	});

	it('影片每一格寫的字和列的名字都是英文', () => {
		const flow = sample();
		const at = videoFrames(flow);
		for (const sec of [0, 2.5, 5, 7.5, 12]) {
			const { where, row } = at(sec);
			expectEnglish([where, ...row.formations, ...row.actions.flatMap((a) => [a.title, a.who]), ...row.continuing.flatMap((c) => [c.name, c.who])]);
		}
		expect(whyText(at(0).where)).toBe('Opening formation');
		expect(whyText(at(2.5).where)).toBe('Music 1 · 8-count 1');
		expect(whyText(at(12).where)).toBe('Cheer 1 · 2.0 s');
		expect(videoRows(flow).map(({ label }) => whyText(label))).toEqual(['Music 1 8-count 1', 'Music 1 8-count 2', 'Music 1 8-count 3', 'Cheer 1']);
	});

	it('站位、走位、成功率、拍點的字都是英文', () => {
		const flow = sample();
		const walk = formationWalks(flow, flow.formations[1].id)[0];
		expectEnglish([
			moveTargetWhy(flow, 0),
			moveTargetWhy(flow, 6.4),
			moveTargetWhy(flow, 2),
			walkSpeedWhy(flow, walk),
			moveFormationHint(flow, flow.formations[0].id),
			moveFormationHint(flow, flow.formations[1].id),
			formationNowWhy(flow, 6.4),
			memberNowWhy(flow, 'm2', 1),
			memberNowWhy(flow, 'm1', 7),
			squadWhy(flow, flow.actions[0], flow.actions[0].members[0].squad!),
			...attemptWhos(flow, flow.actions[0]).map((w) => w.name),
			NOT_YET_TITLE,
			...MARKS.map((m) => m.label),
			...Object.values(CUE_KIND_LABELS)
		]);
		expect(whyText(moveTargetWhy(flow, 2))).toBe('Dragging inserts a new formation at 1-6');
		expect(whyText(moveFormationHint(flow, flow.formations[1].id))).toBe('Can move after Music 1 1-1');
		expect(whyText(memberNowWhy(flow, 'm2', 1))).toBe('Bob · Stunt·Lib Primary base');
		// 騰翻的任務角色跟大類同名：不重複寫
		expect(whyText(memberNowWhy(flow, 'm1', 7))).toBe('Amy · Tumbling');
		expect(whyText(squadWhy(flow, flow.actions[0], flow.actions[0].members[0].squad!))).toBe('Stunt group 1 (Amy)');
	});

	it('改動作會拿掉、切短的拍點和環節：確認清單是英文', () => {
		const r = updateAction(sample(), 'x1', { length: 6 });
		expect(r.kind).toBe('confirm');
		if (r.kind !== 'confirm') return;
		const items = r.whyItems!;
		expect(items.length).toBe(4);
		expectEnglish(items);
		expect(whyText(items[0])).toBe('Remove: Step land 1-5 to 1-6 · for Top person');
		expect(reasonText(r)).not.toMatch(HAN);
	});
});
