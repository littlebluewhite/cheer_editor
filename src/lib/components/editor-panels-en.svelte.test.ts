// 段設定、流程設定、新建流程、時間軸（泳道、站位縮圖列）、規則警告總表、前後八拍照語言寫：英文畫面看不到中文（ADR 0017）。
// 隊員、動作、站位、音樂檔的名字用英文，教練自己取的名字才不算。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	createFlow,
	insertFormation,
	loadSegmentAudio,
	placeCue,
	renameFormation,
	setPositions,
	updateSegment,
	type Clash,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import FlowSettings from './FlowSettings.svelte';
import NewFlowForm from './NewFlowForm.svelte';
import NowEightCount from './NowEightCount.svelte';
import RuleSummary from './RuleSummary.svelte';
import SegmentSettings from './SegmentSettings.svelte';
import Timeline from './Timeline.svelte';

const HAN = /\p{Script=Han}/u;

/** 畫面上看得到、聽得到的字：文字，和 aria-label、title、placeholder。skip：別的元件（不在這幾個檔裡）畫的部分不算。 */
function shown(skip?: string): string[] {
	const body = document.body.cloneNode(true) as HTMLElement;
	if (skip) body.querySelectorAll(skip).forEach((el) => el.remove());
	const attrs = [...body.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) =>
		['aria-label', 'title', 'placeholder'].map((name) => el.getAttribute(name) ?? '')
	);
	return [body.textContent ?? '', ...attrs].filter(Boolean);
}

function expectEnglish(skip?: string) {
	for (const text of shown(skip)) expect(text, text).not.toMatch(HAN);
}

/**
 * 音樂 1（10 個八拍，音樂檔 song.mp3）→ 音樂 2（同一個檔，跟音樂 1 重疊）→ 口號 1；Lib（上層、主底，有拍點）、騰翻；
 * 站位 2「Pyramid」有人走過去；一個自訂任務角色。
 */
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
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', 'song.mp3'));
	flow = flowOf(updateSegment(flow, 's2', { audioId: 'a1' }));
	flow = flowOf(updateSegment(flow, 's1', { eights: 10 }));
	flow = flowOf(addSegment(flow, 'chant'));
	const lib = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members: lib }));
	const all = ['m1', 'm2', 'm3'].map((memberId) => ({ memberId, role: '騰翻' }));
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 16, length: 24, note: '', members: all }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 8, len: 4, word: '落地', who: { role: '上層' } }));
	flow = flowOf(insertFormation(flow, 6.4));
	flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
	flow = flowOf(renameFormation(flow, flow.formations[1].id, 'Pyramid'));
	return flowOf(addCustomRole(flow, { name: 'Flyer', meaning: '' }));
}

describe('英文畫面：段設定、流程設定、時間軸看不到中文', () => {
	beforeEach(() => localStorage.setItem(localStorageKey, 'en'));

	it('音樂段設定：音樂檔、敲擊測速、波形、比音樂長、跟別段重疊都照語言寫', async () => {
		// 音樂檔解碼成 20 秒：音樂 1（32 秒）比它長
		const { editor } = testEditor(sample(), { decode: async () => ({ durationSec: 20, peaks: [0.2, 0.5] }) });
		editor.switchMusic(await editor.readMusic({ a1: new Uint8Array(8) }));
		render(TestSession, { props: { editor, component: SegmentSettings, props: { segmentId: 's1', onclose: vi.fn() } } });
		await fireEvent.click(screen.getByRole('button', { name: 'Tap tempo' }));
		expect(screen.getByRole('heading', { name: 'Music 1 settings' })).toBeTruthy();
		expect(document.body.textContent).toContain('Uses the same music file as Music 2, overlapping by 6.4 s');
		expect(document.body.textContent).toContain('Tap 7 more times');
		expectEnglish();
	});

	it('口號段設定、找不到音樂的音樂段', () => {
		const { editor } = testEditor(sample());
		const { unmount } = render(TestSession, { props: { editor, component: SegmentSettings, props: { segmentId: 's3', onclose: vi.fn() } } });
		expect(screen.getByText('Length (s)')).toBeTruthy();
		expectEnglish();
		unmount();
		render(TestSession, { props: { editor, component: SegmentSettings, props: { segmentId: 's2', onclose: vi.fn() } } });
		expect(document.body.textContent).toContain('song.mp3 (music not found; choose the file again)');
		expectEnglish();
	});

	it('流程設定：場地、規則警告、標記、自訂任務角色', () => {
		const { editor } = testEditor(sample());
		render(TestSession, { props: { editor, component: FlowSettings, props: { onclose: vi.fn() } } });
		expect(screen.getByText('Now 9 panels, front to back')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Delete position “Flyer”' })).toBeTruthy();
		expectEnglish();
	});

	it('新建流程', async () => {
		render(NewFlowForm, { props: { oncreate: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: /Custom/ }));
		expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
		expectEnglish();
	});

	it('時間軸：段列、插入八拍、加段選單、泳道（任務角色、拍點、走位條）、站位縮圖列', async () => {
		const { editor } = testEditor(sample());
		render(TestSession, { props: { editor, component: Timeline, props: { onopensegment: () => {} } } });
		expect(screen.getAllByText('Music not found').length).toBe(2);
		expect(screen.getAllByText('Top person').length).toBeGreaterThan(0);
		expect(document.querySelector('[data-walk]')!.getAttribute('aria-label')).toBe(
			'Amy walks to formation 2: departs Music 1 2-1, arrives Music 1 3-1'
		);
		expectEnglish();
		await fireEvent.click(screen.getByRole('button', { name: 'Insert 8-counts' }));
		expect(screen.getByText('Insert at Music 1 1-1')).toBeTruthy();
		expectEnglish();
		await fireEvent.click(screen.getByRole('button', { name: 'Add a segment at the end' }));
		expect(screen.getByRole('menuitem', { name: '+ Cheer segment' })).toBeTruthy();
		expectEnglish();
	});

	it('規則警告總表、前後八拍', async () => {
		const flow = sample();
		const clash: Clash = { memberIds: ['m1', 'm2'], sec: 3, pos: [0, 0], startSec: 2, endSec: 4, formationId: flow.formations[1].id };
		const { editor } = testEditor(flow);
		render(TestSession, { props: { editor, component: RuleSummary, props: { flow, clashes: [clash] } } });
		await fireEvent.click(screen.getByRole('button', { name: /Collisions 1/ }));
		expect(document.body.textContent).toContain('Amy, Bob');
		expectEnglish();
		document.body.innerHTML = '';
		const props = { flow, memberId: '', sec: 0, before: 1, after: 3, onjump: vi.fn(), picked: null, onpick: vi.fn() };
		render(NowEightCount, { props });
		expect(screen.getAllByText('8-count 1').length).toBeGreaterThan(0);
		// 一列八格的拍點格子（EightCountCueLine）是動作表單那邊的元件，不在這裡改
		expectEnglish('.cue-line');
	});
});
