import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/core/test-flows.js';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import MemberPicker from './MemberPicker.svelte';

/**
 * 音樂 1（150 BPM，一個半拍 0.2 秒）；小A 上、小B 底、小C 底。
 * Lib（小A、小B）0–1.6 秒，跳躍（小C）1.6–2.4 秒。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小C', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	const base = { segmentId: 's1', note: '', name: '' };
	flow = flowOf(
		addAction(flow, {
			...base,
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 8,
			members: [
				{ memberId: 'm1', role: '上層' },
				{ memberId: 'm2', role: '主底' }
			]
		})
	);
	return flowOf(
		addAction(flow, {
			...base,
			category: 'jump',
			start: 8,
			length: 4,
			members: [{ memberId: 'm3', role: null }]
		})
	);
}

/** 放一個帶著範例流程（選了 selected 的人）的 session 進 context，畫選人捷徑；回傳 session。 */
function setup(playheadSec: number, selected: string[] = []) {
	const session = new EditorSession(sample());
	session.selectMembers(selected);
	render(TestSession, { props: { session, component: MemberPicker, props: { playheadSec } } });
	return session;
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('選人捷徑', () => {
	it('全隊、全部底層、全部上層、這一拍沒在動作裡的人、不選人', async () => {
		const session = setup(0.5, ['m1']);
		await click('全隊');
		expect(session.selectedMemberIds).toEqual(['m1', 'm2', 'm3']);
		await click('全部底層');
		expect(session.selectedMemberIds).toEqual(['m2', 'm3']);
		await click('全部上層');
		expect(session.selectedMemberIds).toEqual(['m1']);
		await click('這一拍沒在動作裡的人');
		expect(session.selectedMemberIds).toEqual(['m3']);
		await click('不選人');
		expect(session.selectedMemberIds).toEqual([]);
	});

	it('「沿用上一個動作的人」取播放頭以前最晚結束的動作；再按一次換更早的', async () => {
		const session = setup(3);
		await click('沿用上一個動作的人');
		expect(session.selectedMemberIds).toEqual(['m3']);
		expect(screen.getByRole('status').textContent).toMatch(/選了「跳躍」的 1 人/);
		await click('沿用上一個動作的人');
		expect(session.selectedMemberIds).toEqual(['m1', 'm2']);
		expect(screen.getByRole('status').textContent).toMatch(/選了「技巧·Lib」的 2 人/);
	});

	it('播放頭前面還沒有動作就說一聲，不改選取', async () => {
		const session = setup(1, ['m2']);
		await click('沿用上一個動作的人');
		expect(session.selectedMemberIds).toEqual(['m2']);
		expect(screen.getByRole('status').textContent).toBe('播放頭前面還沒有動作');
	});

	it('顯示已選幾人、是誰', () => {
		setup(0, ['m3', 'm1']);
		expect(screen.getByText(/已選 2 人：小C、小A/)).toBeTruthy();
	});
});
