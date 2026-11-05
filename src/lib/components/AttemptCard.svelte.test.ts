// 記錄頁的一張卡：放一個真的 session 進去，點記號，讀 session 的流程。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { attemptWhos } from '#lib/core';
import { libSample } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import AttemptCard from './AttemptCard.svelte';

const DATE = '2026-11-01';

/** 畫第 1 組（小美、小A）的卡，回傳 session。 */
function setup() {
	const flow = libSample();
	const session = new EditorSession(flow);
	const action = flow.actions[0];
	const { who, name } = attemptWhos(flow, action)[0];
	render(TestSession, { props: { session, component: AttemptCard, props: { action, who, name, date: DATE } } });
	return { session, name };
}

const records = (session: EditorSession) => session.flow!.actions[0].successRate!.records;
const tap = (name: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${name} ${phase} ${mark}` }));

describe('記錄頁的卡', () => {
	it('點 ✓ ✓ △ 存成一次：session 的流程裡有這一次，不算復原的一步', async () => {
		const { session, name } = setup();
		await tap(name, '上法', '成功');
		await tap(name, '中段', '成功');
		expect(records(session)).toEqual([]);
		await tap(name, '下法', '小失誤');

		expect(records(session).map((r) => ({ date: r.date, practice: r.practice, whole: r.whole, marks: r.marks }))).toEqual([
			{ date: DATE, practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } }
		]);
		expect(session.canUndo).toBe(false);
	});

	it('點了 ✗ 就存，後面的環節空著', async () => {
		const { session, name } = setup();
		await tap(name, '上法', '成功');
		await tap(name, '中段', '失敗');
		expect(records(session).map((r) => r.marks)).toEqual([{ p1: '✓', p2: '✗' }]);
	});

	it('選「整個」卻跳過前面的環節：照樣存成只練幾個環節，但卡上說一聲，不是偷偷的', async () => {
		const { session, name } = setup();
		await tap(name, '下法', '成功');
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([[false, { p3: '✓' }]]);
		expect(screen.getByRole('status').textContent).toBe('跳過了前面的環節，這次記成「只練幾個環節」，不算進整次成功率');
		await tap(name, '上法', '成功');
		await tap(name, '中段', '成功');
		await tap(name, '下法', '成功');
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('記兩次再刪掉上一次：session 的流程裡剩第一次', async () => {
		const { session, name } = setup();
		await tap(name, '上法', '失敗');
		await tap(name, '上法', '成功');
		await tap(name, '中段', '失敗');
		expect(records(session)).toHaveLength(2);

		await fireEvent.click(screen.getByRole('button', { name: '刪掉上一次' }));
		expect(records(session).map((r) => r.marks)).toEqual([{ p1: '✗' }]);
		expect(session.canUndo).toBe(false);
	});
});
