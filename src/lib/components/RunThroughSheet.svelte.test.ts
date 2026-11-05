// 記一次全上的表：放一個真的 session 進去，點格子、存，讀 session 的流程。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { ratedSample } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import RunThroughSheet from './RunThroughSheet.svelte';

const DATE = '2026-11-01';

/** 畫全上表（Lib 第 1 組小美、第 2 組小芳；騰翻小美、小A），回傳 session 和關掉的 callback。 */
function setup() {
	const { editor, session } = testEditor(ratedSample());
	const onclose = vi.fn();
	render(TestSession, { props: { editor, component: RunThroughSheet, props: { date: DATE, onclose } } });
	return { session, onclose };
}

/** 一個動作存下來的每一次：記號和練法。 */
const records = (session: EditorSession, index: number) =>
	session.flow!.actions[index].successRate!.records.map((r) => ({ date: r.date, practice: r.practice, marks: r.marks }));
const slot = (who: string, phase: string) => screen.getByRole('button', { name: new RegExp(`^${who} ${phase} `) });
const stopped = (label: string) =>
	within(screen.getByRole('region', { name: label })).getByRole('button', { name: '沒做（停了）' });
/** 表上一個動作的格子，一列一個環節（字擠成一行）。 */
const sheetRows = (label: string) =>
	within(screen.getByRole('region', { name: label }))
		.getAllByRole('row')
		.map((row) => Array.from(row.children).map((c) => c.textContent?.trim() ?? ''));
const tapSlot = async (who: string, phase: string, times = 1) => {
	for (let i = 0; i < times; i++) await fireEvent.click(slot(who, phase));
};

describe('記一次全上的表', () => {
	it('每個要記的動作照流程順序一塊，一欄一組，每格先是 ✓；讀屏讀得出誰、環節、記號', () => {
		setup();
		const sheet = within(screen.getByRole('region', { name: '記一次全上' }));
		expect(sheet.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['技巧·Lib', '騰翻']);
		expect(sheetRows('技巧·Lib')).toEqual([
			['環節', '第 1 組 小美', '第 2 組 小芳'],
			['上法', '✓', '✓'],
			['中段', '✓', '✓'],
			['下法', '✓', '✓']
		]);
		expect(sheetRows('騰翻')).toEqual([
			['環節', '小美', '小A'],
			['整體 騰翻', '✓', '✓']
		]);
		expect(slot('第 2 組 小芳', '下法').getAttribute('aria-label')).toBe('第 2 組 小芳 下法 成功');
	});

	it('點一格 ✓ → △ → ✗ → ✓；變 ✗ 同一組後面變空的，改回來後面回到 ✓', async () => {
		setup();
		await tapSlot('第 2 組 小芳', '下法');
		expect(slot('第 2 組 小芳', '下法').getAttribute('aria-label')).toBe('第 2 組 小芳 下法 小失誤');
		await tapSlot('第 2 組 小芳', '下法');
		expect(slot('第 2 組 小芳', '下法').textContent?.trim()).toBe('✗');

		await tapSlot('第 1 組 小美', '中段', 2);
		expect(sheetRows('技巧·Lib').map((r) => r[1])).toEqual(['第 1 組 小美', '✓', '✗', '']);
		expect(slot('第 1 組 小美', '下法').getAttribute('aria-label')).toBe('第 1 組 小美 下法 空的');
		expect(sheetRows('技巧·Lib').map((r) => r[2])).toEqual(['第 2 組 小芳', '✓', '✓', '✗']);

		await tapSlot('第 1 組 小美', '中段');
		expect(sheetRows('技巧·Lib').map((r) => r[1])).toEqual(['第 1 組 小美', '✓', '✓', '✓']);
	});

	it('「沒做（停了）」：整個動作變空的，再按一次回來', async () => {
		setup();
		await fireEvent.click(stopped('騰翻'));
		expect(stopped('騰翻').getAttribute('aria-pressed')).toBe('true');
		expect(sheetRows('騰翻')[1]).toEqual(['整體 騰翻', '', '']);
		await fireEvent.click(stopped('騰翻'));
		expect(sheetRows('騰翻')[1]).toEqual(['整體 騰翻', '✓', '✓']);
	});

	it('第 2 組下法點成 ✗、騰翻沒做，存：session 的流程裡 Lib 每組多一次全上，騰翻沒有；表關掉；不算復原的一步', async () => {
		const { session, onclose } = setup();
		await fireEvent.click(slot('第 2 組 小芳', '下法'));
		await fireEvent.click(slot('第 2 組 小芳', '下法'));
		await fireEvent.click(stopped('騰翻'));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));

		expect(records(session, 0)).toEqual([
			{ date: DATE, practice: 'runThrough', marks: { p1: '✓', p2: '✓', p3: '✓' } },
			{ date: DATE, practice: 'runThrough', marks: { p1: '✓', p2: '✓', p3: '✗' } }
		]);
		expect(records(session, 1)).toEqual([]);
		expect(onclose).toHaveBeenCalledExactlyOnceWith(true);
		expect(session.canUndo).toBe(false);
	});

	it('中段點成 ✗：存下來的那一次後面空著', async () => {
		const { session } = setup();
		await fireEvent.click(slot('第 1 組 小美', '中段'));
		await fireEvent.click(slot('第 1 組 小美', '中段'));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));
		expect(records(session, 0)[0].marks).toEqual({ p1: '✓', p2: '✗' });
	});

	it('每個動作都沒做：擋下來說原因，session 的流程不變，表還開著', async () => {
		const { session, onclose } = setup();
		const before = session.flow;
		await fireEvent.click(stopped('技巧·Lib'));
		await fireEvent.click(stopped('騰翻'));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));

		expect(screen.getByRole('alert').textContent).toBe('每個動作都沒做，沒有要存的');
		expect(session.flow).toBe(before);
		expect(onclose).not.toHaveBeenCalled();
	});

	it('「後面都沒做」：這個動作後面的都變空的，這個動作照記；再按一次回來', async () => {
		const { session } = setup();
		const rest = () =>
			within(screen.getByRole('region', { name: '技巧·Lib' })).getByRole('button', { name: '後面都沒做' });
		await fireEvent.click(rest());
		expect(rest().getAttribute('aria-pressed')).toBe('true');
		expect(stopped('騰翻').getAttribute('aria-pressed')).toBe('true');
		expect(stopped('技巧·Lib').getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(rest());
		expect(stopped('騰翻').getAttribute('aria-pressed')).toBe('false');

		await fireEvent.click(rest());
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));
		expect(records(session, 0)).toHaveLength(2);
		expect(records(session, 1)).toEqual([]);
	});

	it('最後一個動作沒有「後面都沒做」', () => {
		setup();
		expect(within(screen.getByRole('region', { name: '騰翻' })).queryByRole('button', { name: '後面都沒做' })).toBeNull();
	});

	it('沒改過格子按取消：直接關掉，什麼都不存', async () => {
		const { session, onclose } = setup();
		const before = session.flow;
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(onclose).toHaveBeenCalledExactlyOnceWith(false);
		expect(session.flow).toBe(before);
	});

	it('改過格子後按取消先問：選「繼續記」表還在、格子還在；選「丟掉」才關掉', async () => {
		const { session, onclose } = setup();
		const before = session.flow;
		await fireEvent.click(slot('第 2 組 小芳', '下法'));
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		const confirm = within(screen.getByRole('alertdialog'));
		expect(confirm.getByText('改過的格子還沒存，要丟掉嗎？')).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();

		await fireEvent.click(confirm.getByRole('button', { name: '繼續記' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(slot('第 2 組 小芳', '下法').getAttribute('aria-label')).toBe('第 2 組 小芳 下法 小失誤');

		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '丟掉' }));
		expect(onclose).toHaveBeenCalledExactlyOnceWith(false);
		expect(session.flow).toBe(before);
	});

	it('按了「沒做（停了）」也算改過', async () => {
		const { onclose } = setup();
		await fireEvent.click(stopped('騰翻'));
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(screen.getByRole('alertdialog')).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();
	});
});
