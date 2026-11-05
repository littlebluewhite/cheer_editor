// 記錄頁的一張卡：放一個真的 session 進去，點記號，讀 session 的流程。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptWhos, recordAttempt, recordRunThrough } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { libSample } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import AttemptCard from './AttemptCard.svelte';

const DATE = '2026-11-01';

/** 畫第 1 組（小美、小A）的卡，回傳 session。 */
function setup(flow = libSample()) {
	const { editor, session } = testEditor(flow);
	const action = flow.actions[0];
	const { who, name } = attemptWhos(flow, action)[0];
	render(TestSession, { props: { editor, component: AttemptCard, props: { action, who, name, date: DATE } } });
	return { session, name };
}

const records = (session: EditorSession) => session.flow!.actions[0].successRate!.records;
const tap = (name: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${name} ${phase} ${mark}` }));

const save = () => fireEvent.click(screen.getByRole('button', { name: '存這一次' }));
const removeLast = () => fireEvent.click(screen.getByRole('button', { name: '刪掉上一次' }));
const pressed = (name: string, phase: string, mark: string) =>
	screen.getByRole('button', { name: `${name} ${phase} ${mark}` }).getAttribute('aria-pressed');
const dayRow = () => screen.queryAllByRole('listitem').map((li) => [li.textContent, li.classList.contains('run')]);

afterEach(() => {
	vi.useRealTimers();
});

describe('記錄頁的卡', () => {
	it('「整個」：點 ✓ ✓ △ 還沒存，按「存這一次」才存；不算復原的一步', async () => {
		const { session, name } = setup();
		await tap(name, '上法', '成功');
		await tap(name, '中段', '成功');
		await tap(name, '下法', '小失誤');
		expect(records(session)).toEqual([]);
		await save();

		expect(records(session).map((r) => ({ date: r.date, practice: r.practice, whole: r.whole, marks: r.marks }))).toEqual([
			{ date: DATE, practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } }
		]);
		expect(session.canUndo).toBe(false);
		expect(pressed(name, '下法', '小失誤')).toBe('false');
	});

	it('存好顯示「已存」，幾秒後消失', async () => {
		vi.useFakeTimers();
		const { name } = setup();
		await tap(name, '上法', '成功');
		await save();
		expect(screen.getByRole('status').textContent).toBe('已存');
		await vi.advanceTimersByTimeAsync(6000);
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('還沒點就不能存', () => {
		setup();
		expect((screen.getByRole('button', { name: '存這一次' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('「整個」點了 ✗ 不自動存；存下來後面的環節空著', async () => {
		const { session, name } = setup();
		await tap(name, '上法', '成功');
		await tap(name, '中段', '失敗');
		expect(records(session)).toEqual([]);
		await save();
		expect(records(session).map((r) => r.marks)).toEqual([{ p1: '✓', p2: '✗' }]);
	});

	it('再按一次點著的記號就取消', async () => {
		const { session, name } = setup();
		await tap(name, '上法', '成功');
		await tap(name, '中段', '失敗');
		await tap(name, '中段', '失敗');
		expect(pressed(name, '中段', '失敗')).toBe('false');
		await tap(name, '中段', '小失誤');
		await tap(name, '下法', '成功');
		await save();
		expect(records(session).map((r) => r.marks)).toEqual([{ p1: '✓', p2: '△', p3: '✓' }]);
	});

	it('「整個」卻跳過前面的環節：存之前就提醒；存成只練幾個環節', async () => {
		const { session, name } = setup();
		await tap(name, '下法', '成功');
		expect(screen.getByText('跳過了前面的環節，存了會記成「只練幾個環節」，不算進整次成功率')).toBeTruthy();
		expect(records(session)).toEqual([]);
		await tap(name, '上法', '成功');
		await tap(name, '中段', '成功');
		expect(screen.queryByText(/跳過了前面的環節/)).toBeNull();
		await tap(name, '中段', '成功');
		await save();
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([[false, { p1: '✓', p3: '✓' }]]);
	});

	it('「只練幾個環節」：點到最後一個選的環節就自動存', async () => {
		const { session, name } = setup();
		await fireEvent.click(screen.getByRole('radio', { name: '只練幾個環節' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: '上法' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: '下法' }));
		expect(screen.queryByRole('button', { name: '存這一次' })).toBeNull();
		await tap(name, '上法', '成功');
		expect(records(session)).toEqual([]);
		await tap(name, '下法', '小失誤');
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([[false, { p1: '✓', p3: '△' }]]);
	});

	/** 第 1 組這天：全上 ✓✗、分段練 ✗、全上 △✓✓。 */
	function mixed() {
		let flow = flowOf(recordRunThrough(libSample(), DATE, [{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✗' } }]));
		flow = flowOf(recordAttempt(flow, 'x1', { date: DATE, who: 'g1', practice: 'drill', whole: true, marks: { p1: '✗' } }));
		return flowOf(recordRunThrough(flow, DATE, [{ actionId: 'x1', who: 'g1', marks: { p1: '△', p2: '✓', p3: '✓' } }]));
	}

	it('全上記的那幾筆用另一種外框', () => {
		setup(mixed());
		expect(dayRow()).toEqual([
			['✓✗·', true],
			['✗··', false],
			['△✓✓', true]
		]);
	});

	it('刪掉上一次：只刪這張卡記的分段練，全上的不動', async () => {
		const { session } = setup(mixed());
		await removeLast();
		expect(records(session).map((r) => [r.practice, r.marks])).toEqual([
			['runThrough', { p1: '✓', p2: '✗' }],
			['runThrough', { p1: '△', p2: '✓', p3: '✓' }]
		]);
		expect(session.canUndo).toBe(false);
	});

	it('這天只有全上：「刪掉上一次」不能按', () => {
		setup(flowOf(recordRunThrough(libSample(), DATE, [{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✗' } }])));
		expect((screen.getByRole('button', { name: '刪掉上一次' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('刪掉後顯示「已刪掉」和「救回」：按救回放回原位；幾秒後消失', async () => {
		vi.useFakeTimers();
		const { session } = setup(mixed());
		const before = records(session);
		await removeLast();
		expect(records(session).map((r) => r.id)).toEqual([before[0].id, before[2].id]);
		expect(screen.getByRole('status').textContent).toContain('已刪掉');
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		expect(records(session)).toEqual(before);
		expect(session.canUndo).toBe(false);

		await removeLast();
		await vi.advanceTimersByTimeAsync(6000);
		expect(screen.queryByRole('button', { name: '救回' })).toBeNull();
	});
});
