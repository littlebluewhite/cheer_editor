// 流程核心給畫面的字（位置、八拍尺、規則警告、場地位置、提醒、場地範本、顏色、拍的範圍、打時間的例子）：英文畫面沒有中文。
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import {
	ACTION_COLORS,
	actionHints,
	addSegment,
	adjustField,
	beatSpanWhy,
	createFlow,
	FIELD_TEMPLATES,
	fieldPositionWhy,
	PHASE_COLORS,
	positionWhy,
	readJump,
	readTime,
	rulerMarks,
	timeExamples,
	timeInputWhy,
	timeRuleWarnings,
	totalSeconds,
	updateTimeRules,
	type FieldConfig,
	type Flow,
	type Segment
} from '#lib/core';
import { flowOf } from './test-flows';
import { reasonText, whyText } from './reason-text';

const HAN = /\p{Script=Han}/u;

/** 音樂 1 → 口號 1 → 音樂 2。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } }));
	for (const kind of ['music', 'chant', 'music'] as const) flow = flowOf(addSegment(flow, kind));
	return flow;
}

describe('流程核心給畫面的字：英文', () => {
	it('上方列的位置、八拍尺的刻度字', () => {
		localStorage.setItem(localStorageKey, 'en');
		const flow = sample();
		expect(whyText(positionWhy(flow, 0))).toBe('Music 1 1-1');
		expect(whyText(positionWhy(flow, 25.6 + 5.37))).toBe('Cheer 1 5.3 s');
		expect(whyText(positionWhy(flow, totalSeconds(flow)))).toBe('End');
		const labels = rulerMarks(flow).flatMap((m) => (m.label ? [whyText(m.label)] : []));
		expect(labels).toContain('5 s');
		for (const l of labels) expect(l).not.toMatch(HAN);
	});

	it('打時間的例子、格子裡的時間照英文寫，打回去也看得懂', () => {
		localStorage.setItem(localStorageKey, 'en');
		const flow = sample();
		const { other } = timeExamples(flow, 's1');
		expect(whyText(other)).toBe('Cheer 1 5.0');
		expect(readTime(flow, 's1', whyText(other), '出發')).toEqual({ kind: 'ok', value: { segmentId: 's2', at: 50 } });
		const box = whyText(timeInputWhy(flow, 's1', { segmentId: 's2', at: 53 }));
		expect(box).toBe('Cheer 1 5.3');
		expect(readTime(flow, 's1', box, '出發')).toEqual({ kind: 'ok', value: { segmentId: 's2', at: 53 } });
		// 播放頭在口號段、好幾個音樂段：說要加段名，例子照英文寫
		const blocked = readJump(flow, 30, '1-3');
		expect(blocked.kind).toBe('blocked');
		if (blocked.kind === 'blocked') expect(reasonText(blocked)).not.toMatch(HAN);
		expect(readJump(flow, 30, 'Music 2 1-3').kind).toBe('ok');
	});

	it('時間規則警告', () => {
		localStorage.setItem(localStorageKey, 'en');
		const onlyMusic = flowOf(addSegment(flowOf(createFlow({ name: 'Test', field: { strips: 9, layout: 'vertical' } })), 'music'));
		const tight = flowOf(updateTimeRules(sample(), { minChantSec: 15, maxMusicSec: 10, maxTotalSec: 20 }));
		const warnings = [...timeRuleWarnings(onlyMusic), ...timeRuleWarnings(tight)];
		expect(warnings).toHaveLength(4);
		for (const w of warnings) expect(`${whyText(w.title)} ${whyText(w.text)}`).not.toMatch(HAN);
		expect(whyText(warnings[0].text)).toBe('Cheer segments must total at least 0:30.0');
	});

	it('場地上的位置、場地範本、提醒、顏色', () => {
		localStorage.setItem(localStorageKey, 'en');
		const nine: FieldConfig = { strips: 9, layout: 'vertical' };
		const five: FieldConfig = { strips: 5, layout: 'horizontal' };
		expect(whyText(fieldPositionWhy(nine, [-4.1148, 3.6576]))).toBe('panel 3, 1/4 from left | grid square 2 from front, 1/2');
		expect(whyText(fieldPositionWhy(nine, [-4.572 + 0.02 * 1.8288, 3.6576]))).toBe(
			'about seam of panels 2 and 3 | grid square 2 from front, 1/2'
		);
		const spots: [FieldConfig, [number, number]][] = [
			[nine, [8.2296, -6.4008]],
			[nine, [-8.2296, 6.858]],
			[nine, [-9.144 + 0.3, 0]],
			[nine, [8.6868, 0]],
			[five, [-5.9436, 5 * 0.9144]],
			[five, [-5.9436, 0]]
		];
		for (const [field, p] of spots) expect(whyText(fieldPositionWhy(field, p))).not.toMatch(HAN);
		for (const t of FIELD_TEMPLATES) expect(`${whyText(t.label)} ${whyText(t.hint)}`).not.toMatch(HAN);
		const hints = actionHints({ category: 'stunt', members: [{ memberId: 'm1', role: '上層' }] });
		expect(hints.map(whyText)).toEqual(['There\'s a top person but no base (base, primary base, side base, shoulder stand base)']);
		for (const c of [...ACTION_COLORS, ...PHASE_COLORS]) expect(whyText(c.label)).not.toMatch(HAN);
	});

	it('拍的範圍、調整場地時疊在一起的人', () => {
		localStorage.setItem(localStorageKey, 'en');
		const music = { kind: 'music' } as Segment;
		expect(whyText(beatSpanWhy(music, 36, 4))).toBe('3-3 to 3-4 · 2 beats');
		expect(whyText(beatSpanWhy(music, 36, 2))).toBe('3-3 · 1 beat');
		const members = (['a', 'b'] as const).map((id) => ({ id, name: id.toUpperCase(), gender: 'F' as const, globalRole: 'base' as const }));
		const flow: Flow = {
			...sample(),
			members,
			formations: [{ ...sample().formations[0], name: 'Open', pos: { a: [0, 0], b: [1.8288 / 9, 0] } }]
		};
		const asked = adjustField(flow, { strips: 1, layout: 'vertical' });
		expect(asked.kind).toBe('confirm');
		if (asked.kind !== 'confirm') return;
		expect(asked.items).toEqual(['站位 1「Open」：A、B']);
		expect(asked.whyItems?.map(whyText)).toEqual(['Formation 1 “Open”: A, B']);
	});
});
