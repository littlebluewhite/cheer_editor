// 有自己紅字的欄位（被擋時寫「「格名」退回原本的值：…」）：被退回後再打，紅字要跟著收（N34）。
// 每一格跑同一套：打錯送出 → 退回、紅字 → 再打錯 → 改回原本的值送出 → 紅字不見、流程沒變。
// 改回原本的值時 change 被 pending-input 吞掉（值跟上次送出的一樣），所以紅字不能等送出才收。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { addSegment, createFlow, type Flow } from '#lib/core';
import { domPendingInput } from '#lib/pending-input.js';
import { flowOf } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import FlowSettings from './FlowSettings.svelte';
import SegmentSettings from './SegmentSettings.svelte';

afterEach(cleanup);

/** 一段音樂段 s1、一段口號段 s2。 */
function twoSegments(): Flow {
	const flow = flowOf(addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
	return flowOf(addSegment(flow, 'chant'));
}

function show(component: 'segment' | 'flow', segmentId = 's1') {
	const flow = twoSegments();
	const { editor, session } = testEditor(flow, { pendingInput: domPendingInput });
	const props =
		component === 'segment'
			? { component: SegmentSettings, props: { segmentId: flow.segments.find((s) => s.id === segmentId)!.id, onclose: () => {} } }
			: { component: FlowSettings, props: { onclose: () => {} } };
	render(TestSession, { props: { editor, ...props } });
	return session;
}

const FIELDS: { component: 'segment' | 'flow'; segmentId?: string; label: string; wrong: string }[] = [
	{ component: 'segment', label: 'BPM', wrong: '200' },
	{ component: 'segment', label: '第一拍（秒）', wrong: '看不懂' },
	{ component: 'segment', label: '八拍數', wrong: '看不懂' },
	{ component: 'segment', label: '最後一個八拍有幾拍', wrong: '看不懂' },
	{ component: 'segment', segmentId: 's2', label: '長度（秒）', wrong: '看不懂' },
	{ component: 'flow', label: '流程名字', wrong: '' },
	{ component: 'flow', label: '口號段加起來最少（秒）', wrong: '0' },
	{ component: 'flow', label: '音樂段加起來最多（秒）', wrong: '0' },
	{ component: 'flow', label: '整支流程最多（秒）', wrong: '0' }
];

const fieldAlert = (label: string) => screen.queryAllByRole('alert').find((a) => a.textContent!.startsWith(`「${label}」`));

describe('欄位被退回後，打回原本的值送出：紅字收掉（N34）', () => {
	it.each(FIELDS)('$label', async ({ component, segmentId, label, wrong }) => {
		const session = show(component, segmentId);
		const input = screen.getByLabelText(label) as HTMLInputElement;
		const original = input.value;
		input.focus();

		await fireEvent.input(input, { target: { value: wrong } });
		await fireEvent.change(input);
		expect(input.value).toBe(original);
		expect(fieldAlert(label)?.textContent).toContain('退回原本的值');

		await fireEvent.input(input, { target: { value: wrong === '0' ? '-1' : `${wrong}再錯` } });
		await fireEvent.input(input, { target: { value: original } });
		await fireEvent.change(input);
		expect(fieldAlert(label)).toBeUndefined();
		expect(session.canUndo).toBe(false);
	});
});
