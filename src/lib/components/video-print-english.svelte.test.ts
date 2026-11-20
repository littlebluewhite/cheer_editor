// 英文畫面：流程影片的版面、輸出影片的對話框、八拍表、場地，使用者看得到的字都沒有中文（隊員名字用英文，不算教練打的字）。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	VIDEO_FPS,
	addAction,
	addMembers,
	addPhase,
	addSegment,
	createFlow,
	insertFormation,
	placeCue,
	videoDurationSec,
	videoFrames,
	type Clash,
	type Flow,
	type VideoRow
} from '#lib/core';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { fakeMeasure as measure, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import TestSession from '#lib/TestSession.svelte';
import { failureReason } from '#lib/video/encoder.js';
import { layoutFrame } from '#lib/video/layout.js';
import Field from './Field.svelte';
import PrintSheet from './PrintSheet.svelte';
import VideoExport from './VideoExport.svelte';

const HAN = /\p{Script=Han}/u;
/**
 * 畫面（連 aria-label、title、data-*）裡的中文，前後各帶幾個字，看得出是哪裡。
 * 不看別的元件（八拍表的拍點那一排 EightCountCueLine、場地的選人工具列 SelectionTools）：它們另外改。
 */
function hanBits(): string[] {
	const body = document.body.cloneNode(true) as HTMLElement;
	for (const el of body.querySelectorAll('.cue-line, [role="toolbar"]')) el.remove();
	return [...body.innerHTML.matchAll(/.{0,40}\p{Script=Han}+.{0,10}/gu)].map((x) => x[0]);
}

/** 音樂 1（還沒選音樂）：Amy 上層、Ben 主底做 Lib（有備註、上法、拍點），Cal 跳；第 2 個八拍一張站位。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: 'Nationals', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: 'Amy', gender: 'F', globalRole: 'top' },
			{ name: 'Ben', gender: 'M', globalRole: 'base' },
			{ name: 'Cal', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 16,
			note: 'slow',
			members: [
				{ memberId: 'm1', role: '上層' },
				{ memberId: 'm2', role: '主底' }
			]
		})
	);
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'jump', name: '', start: 5, length: 2, note: '', members: [{ memberId: 'm3', role: null }] }));
	flow = flowOf(addPhase(flow, 'x1', { kind: 'load', name: '', beats: { at: 0, len: 4 } }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 2, word: 'down', who: { role: '上層' } }));
	return flowOf(insertFormation(flow, 3.2));
}

beforeEach(() => localStorage.setItem(localStorageKey, 'en'));

describe('英文畫面：流程影片', () => {
	it('每一格的字都沒有中文', () => {
		const flow = sample();
		const frameAt = videoFrames(flow);
		const frames = Math.round(videoDurationSec(flow) * VIDEO_FPS);
		const texts = new Set<string>();
		for (let i = 0; i < frames; i += 5) for (const t of layoutFrame(flow.field, frameAt(i / VIDEO_FPS), measure).texts) texts.add(t.text);
		expect([...texts].filter((t) => HAN.test(t))).toEqual([]);
		expect(texts).toContain('Note: slow');
	});

	it('空的列、還在做的動作、拿掉的動作、放不下的拍點：照英文寫', () => {
		const frame = (row: VideoRow) => ({ ...videoFrames(sample())(1), row });
		const row = (r: Partial<VideoRow>): VideoRow => ({ formations: [], actions: [], continuing: [], cues: [], empty: false, ...r });
		const strings = (r: VideoRow) => layoutFrame({ strips: 9, layout: 'vertical' }, frame(r), measure).texts.map((t) => t.text);
		expect(strings(row({ empty: true }))).toContain('No new skills or formations in this row');
		expect(strings(row({ continuing: [{ name: 'Lib', who: 'Amy' }, { name: 'Toss', who: '' }] }))).toEqual(
			expect.arrayContaining(['↳ Lib continues: Amy', '↳ Toss continues'])
		);
		const long = 'x '.repeat(400);
		const actions = Array.from({ length: 3 }, (_, i) => ({ title: `Skill ${i}`, who: long, note: '' }));
		const crowded = strings(row({ actions }));
		expect(crowded.some((t) => /^…\d+ more skills?$/.test(t))).toBe(true);
		const cues = Array.from({ length: 30 }, (_, i) => ({
			category: 'stunt' as const,
			name: `Lib ${i}`,
			cues: [{ kind: 'count' as const, from: 1, to: 2, start: 0, end: 4, span: '', lead: '', continued: false, word: 'down', who: null }],
			phases: []
		}));
		expect(strings(row({ actions: [{ title: 'Lib', who: '', note: '' }], cues })).some((t) => /^…\d+ more cue lines?$/.test(t))).toBe(true);
	});

	it('輸出影片的對話框、沒做成的原因：沒有中文', async () => {
		const { editor } = testEditor(sample());
		render(TestSession, { props: { editor, component: VideoExport, props: { flow: sample(), measure, onclose: vi.fn() } } });
		expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy();
		expect(screen.getByText('Music is missing for these segments, so they’ll be silent in the video: Music 1 (no music chosen yet)')).toBeTruthy();
		expect(hanBits()).toEqual([]);
		expect(failureReason(new DOMException('', 'QuotaExceededError'))).toBe('Not enough memory. Close other tabs and try again');
		expect(failureReason(new Error('x'))).toBe('Something went wrong while making the video');
	});
});

describe('英文畫面：八拍表', () => {
	it('全隊的表、一個人的表：沒有中文', async () => {
		render(PrintSheet, { flow: sample(), onclose: vi.fn(), print: vi.fn() });
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nationals · 8-count sheet · Whole team');
		expect(hanBits()).toEqual([]);
		await fireEvent.change(screen.getByLabelText('Print for'), { target: { value: 'm3' } });
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nationals · 8-count sheet · Cal (no. 3)');
		expect(screen.getAllByText('Cal has no skills or formation changes in these counts').length).toBeGreaterThan(0);
		expect(hanBits()).toEqual([]);
	});

	it('還沒有動作', () => {
		render(PrintSheet, { flow: flowOf(createFlow({ name: 'Nationals', field: { strips: 9, layout: 'vertical' } })), onclose: vi.fn(), print: vi.fn() });
		expect(hanBits()).toEqual([]);
	});
});

describe('英文畫面：場地', () => {
	it('放大縮小、圖例、撞位、選到的人：沒有中文', async () => {
		const flow = sample();
		const { editor, session } = testEditor(flow);
		session.selectMembers(['m1']);
		const clash: Clash = { memberIds: ['m1', 'm2'], sec: 3.2, pos: [1, 0.5], startSec: 2.6, endSec: 3.8, formationId: 'f2' };
		const positions = { m1: [0, 0], m2: [2, 0], m3: [-2, 0] };
		render(TestSession, { props: { editor, component: Field, props: { field: flow.field, members: flow.members, positions, clashes: [clash] } } });
		await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
		expect(screen.getByRole('button', { name: 'Pan' })).toBeTruthy();
		expect(document.querySelector('[data-clash] title')!.textContent).toBe('Collision: Amy, Ben');
		expect(hanBits()).toEqual([]);
	});
});
