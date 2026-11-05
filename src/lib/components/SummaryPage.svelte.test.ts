// 總表：放一個帶好紀錄的 session 進去，點按鈕、格子，讀畫面和 session 的流程。
// 篩選、顏色、明細的基本行為在整頁測試（routes/practice.svelte.test.ts 的「練習：總表」）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { recordAttempt, recordRunThrough, type Flow } from '#lib/core';
import { flowOf, ratedSample } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import SummaryPage from './SummaryPage.svelte';

const DATE = '2026-11-04';

/**
 * ratedSample()（Lib 三個環節，第 1 組、第 2 組；騰翻一個環節，小美、小A）加上 11/4 的紀錄：
 * Lib 第 1 組分段練 ✓✓△；全上兩次（r1：第 1 組 ✓✓✓、小美 ✓；r2：第 1 組 ✓✗、小美 ✗）。
 */
function sampleFlow(): Flow {
	let flow = flowOf(
		recordAttempt(ratedSample(), 'x1', { date: DATE, who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } })
	);
	const tumbling = flow.actions[1].successRate!.phases[0].id;
	flow = flowOf(
		recordRunThrough(flow, DATE, [
			{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } },
			{ actionId: 'x2', who: 'm1', marks: { [tumbling]: '✓' } }
		])
	);
	return flowOf(
		recordRunThrough(flow, DATE, [
			{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✗' } },
			{ actionId: 'x2', who: 'm1', marks: { [tumbling]: '✗' } }
		])
	);
}

function setup(flow = sampleFlow()) {
	const { editor, session } = testEditor(flow);
	render(TestSession, { props: { editor, component: SummaryPage, props: { date: DATE } } });
	return session;
}

/** 一個動作那一塊的表：每一列的格子（字擠成一行）。 */
const blockRows = (label: string) =>
	within(within(screen.getByRole('region', { name: label })).getByRole('table'))
		.getAllByRole('row')
		.map((row) => Array.from(row.children).map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? ''));

describe('總表', () => {
	it('「刪掉上一次全上」：整次拿掉這天最後存的全上，寫出刪了第幾次；按「救回」放回去', async () => {
		const session = setup();
		const runs = () => session.flow!.actions.flatMap((a) => a.successRate!.records.filter((r) => r.runThroughId === 'r2'));
		expect(runs()).toHaveLength(2);
		expect(blockRows('技巧·Lib')[1]).toEqual(['上法', '100% 3 次', '—', '100% 3 次']);

		await fireEvent.click(screen.getByRole('button', { name: '刪掉上一次全上' }));
		expect(runs()).toEqual([]);
		expect(blockRows('技巧·Lib')[1]).toEqual(['上法', '100% 2 次', '—', '100% 2 次']);
		expect(screen.getByRole('status').textContent).toContain('已刪掉第 2 次全上');
		expect(session.canUndo).toBe(false);

		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		expect(runs()).toHaveLength(2);
		expect(screen.getByRole('status').textContent).toBe('已救回');
	});

	it('顏色有圖例；「最近 7 天」寫出是哪幾天', () => {
		setup();
		const legend = within(screen.getByRole('list', { name: '顏色' }));
		expect(legend.getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual([
			'90% 以上',
			'75–89%',
			'75% 以下',
			'— 沒有紀錄'
		]);
		expect(within(screen.getByRole('group', { name: '期間' })).getByRole('button', { name: /^最近 7 天/ }).textContent).toBe(
			'最近 7 天（10/29–11/4）'
		);
	});

	it('只有一個環節的動作：不重複顯示「整次」那一列', () => {
		setup();
		expect(blockRows('騰翻')).toEqual([
			['環節', '小美', '小A', '合計'],
			['整體 騰翻', '50% 2 次', '—', '50% 2 次']
		]);
		expect(blockRows('技巧·Lib').at(-1)?.[0]).toBe('整次');
	});

	it('「整次」的格子也能點：明細列出整個做的每一次，全上的有標出來', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: /^第 1 組 小美 整次 / }));
		const detail = within(screen.getByRole('complementary', { name: '明細' }));
		expect(detail.getByRole('heading').textContent).toBe('第 1 組 小美 整次');
		const days = detail.getAllByRole('listitem').filter((li) => li.querySelector('time'));
		expect(days.map((li) => li.textContent?.replace(/\s+/g, ''))).toEqual(['2026-11-04✓✓△✓✓✓全上✓✗·全上']);
	});
});
