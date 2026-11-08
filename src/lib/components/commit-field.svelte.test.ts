// 有自己紅字的欄位（被擋時寫「「格名」退回原本的值：…」）：被退回後再打，紅字要跟著收（N34）。
// 每一格跑同一套：打錯送出 → 退回、紅字 → 再打錯 → 改回原本的值送出 → 紅字不見、流程沒變。
// 改回原本的值時 change 被 pending-input 吞掉（值跟上次送出的一樣），所以紅字不能等送出才收。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { addCustomRole, addMembers, addSegment, createFlow, type Flow } from '#lib/core';
import { domPendingInput } from '#lib/pending-input.js';
import { flowOf } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import FlowSettings from './FlowSettings.svelte';
import MemberPanel from './MemberPanel.svelte';
import RoleGlossary from './RoleGlossary.svelte';
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

// 被擋的原因寫在表單上（沒有格名，ask.error）的欄位：一樣打字就收紅字。
// 名詞對照表的「意思」、站位名稱沒放進來：編輯模式下擋不到（意思沒有規則；站位名稱太長的字打的時候就切掉），檢視模式又看不到這些欄位。
const ERROR_FIELDS: { name: string; component: Component<any>; label: string }[] = [
	{ name: '流程設定的自訂任務角色名稱', component: FlowSettings, label: '「旗手」的名稱' },
	{ name: '名詞對照表的自訂任務角色名稱', component: RoleGlossary, label: '「旗手」的名稱' },
	{ name: '隊員名字', component: MemberPanel, label: '第 1 位隊員的名字' }
];

describe('表單上的紅字：欄位被退回後，打回原本的值送出，紅字收掉（N34）', () => {
	it.each(ERROR_FIELDS)('$name', async ({ component, label }) => {
		let flow = flowOf(addMembers(twoSegments(), [{ name: '小A', gender: 'F', globalRole: 'top' }]));
		flow = flowOf(addCustomRole(flow, { name: '旗手', meaning: '拿旗' }));
		const { editor, session } = testEditor(flow, { pendingInput: domPendingInput });
		render(TestSession, { props: { editor, component, props: { onclose: () => {} } } });
		const input = screen.getByLabelText(label) as HTMLInputElement;
		input.focus();

		await fireEvent.input(input, { target: { value: '' } });
		await fireEvent.change(input);
		expect(input.value).not.toBe('');
		const original = input.value;
		expect(screen.queryAllByRole('alert')).not.toHaveLength(0);

		await fireEvent.input(input, { target: { value: '  ' } });
		await fireEvent.input(input, { target: { value: original } });
		await fireEvent.change(input);
		expect(screen.queryAllByRole('alert')).toHaveLength(0);
		expect(session.canUndo).toBe(false);
	});
});
