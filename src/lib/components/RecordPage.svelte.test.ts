// 記錄頁：放一個帶好流程的 session 進去，選動作、點卡、記全上，讀 session 的流程。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { practiceFlow, testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import RecordPage from './RecordPage.svelte';

const DATE = '2026-11-01';

/** 畫 practiceFlow() 的記錄頁（Lib 第 1 組小美、第 2 組小芳；拋投沒有環節；騰翻小美、小A），回傳 session。 */
function setup() {
	const { editor, session } = testEditor(practiceFlow());
	render(TestSession, { props: { editor, component: RecordPage, props: { date: DATE } } });
	return session;
}

/** 左邊清單裡的動作（名字開頭，後面跟著記了幾次）。 */
const pickAction = (label: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
/** 一組（或一個人）的卡。 */
const card = (who: string) => within(screen.getByRole('region', { name: who }));
/** 點卡上一個環節的記號：mark 是成功、小失誤、失敗。 */
const tap = (who: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${who} ${phase} ${mark}` }));
/** 按卡上的「存這一次」。 */
const save = (who: string) => fireEvent.click(card(who).getByRole('button', { name: '存這一次' }));
/** 卡片下面那一排：這天的每一次。 */
function dayRow(who: string): (string | undefined)[] {
	const list = card(who).queryByRole('list', { name: '這天的每一次' });
	return list ? within(list).getAllByRole('listitem').map((li) => li.textContent?.trim()) : [];
}
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled;

const sheet = () => within(screen.getByRole('region', { name: '記一次全上' }));
const openSheet = () => fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
/** 點表上的一格 times 次（✓ → △ → ✗）。 */
async function tapSlot(who: string, phase: string, times: number) {
	for (let i = 0; i < times; i++) await fireEvent.click(sheet().getByRole('button', { name: new RegExp(`^${who} ${phase} `) }));
}

describe('記錄頁', () => {
	it('左邊照流程順序列出有環節的動作和這天記了幾次；騰翻每人一張卡', async () => {
		setup();
		const list = within(screen.getByRole('list', { name: '記成功率的動作' }));
		expect(list.getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'技巧·Lib 這天 0 次',
			'騰翻 這天 0 次'
		]);
		await tap('第 1 組 小美', '上法', '失敗');
		await save('第 1 組 小美');
		expect(list.getByRole('button', { name: /^技巧·Lib/ }).textContent).toContain('這天 1 次');

		await pickAction('騰翻');
		expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['小美', '小A']);
		await tap('小A', '整體 騰翻', '成功');
		await save('小A');
		expect(dayRow('小A')).toEqual(['✓']);
	});

	it('卡上點 ✓ ✓ △ 再按「存這一次」才存成一次，卡片下面出現 ✓✓△，寫「已存」；別組的卡不動', async () => {
		setup();
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		await tap('第 1 組 小美', '下法', '小失誤');
		expect(dayRow('第 1 組 小美')).toEqual([]);
		await save('第 1 組 小美');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
		expect(card('第 1 組 小美').getByRole('status').textContent).toBe('已存');
		expect(dayRow('第 2 組 小芳')).toEqual([]);
	});

	it('卡上「刪掉上一次」：拿掉這組這天最後一次；顯示「已刪掉」，按「救回」放回去；沒有就不能按', async () => {
		setup();
		const who = '第 1 組 小美';
		const removeLast = () => card(who).getByRole('button', { name: '刪掉上一次' });
		expect(disabled(removeLast())).toBe(true);
		await tap(who, '上法', '失敗');
		await save(who);
		await tap(who, '上法', '成功');
		await tap(who, '中段', '失敗');
		await save(who);
		expect(dayRow(who)).toEqual(['✗··', '✓✗·']);
		await fireEvent.click(removeLast());
		expect(dayRow(who)).toEqual(['✗··']);
		expect(card(who).getByRole('status').textContent).toContain('已刪掉');
		await fireEvent.click(card(who).getByRole('button', { name: '救回' }));
		expect(dayRow(who)).toEqual(['✗··', '✓✗·']);
		expect(card(who).getByRole('status').textContent).toBe('已救回');
		await fireEvent.click(removeLast());
		expect(dayRow(who)).toEqual(['✗··']);
		await fireEvent.click(removeLast());
		expect(dayRow(who)).toEqual([]);
		expect(disabled(removeLast())).toBe(true);
	});

	it('點到一半就換動作：這一次不存', async () => {
		setup();
		const who = '第 1 組 小美';
		await tap(who, '上法', '成功');
		await tap(who, '中段', '成功');
		await pickAction('騰翻');
		await pickAction('技巧·Lib');
		expect(card(who).getByRole('button', { name: `${who} 上法 成功` }).getAttribute('aria-pressed')).toBe('false');
		await tap(who, '下法', '成功');
		await save(who);
		expect(dayRow(who)).toEqual(['··✓']);
	});
});

describe('記錄頁記一次全上', () => {
	it('按「＋ 記一次全上」打開全上表；存好回到記錄頁，寫「已存這次全上」，卡片和流程裡都有這次全上', async () => {
		const session = setup();
		await openSheet();
		await tapSlot('第 2 組 小芳', '下法', 2);
		await fireEvent.click(within(sheet().getByRole('region', { name: '騰翻' })).getByRole('button', { name: '沒做（停了）' }));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));

		expect(screen.queryByRole('region', { name: '記一次全上' })).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('已存這次全上');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓✓']);
		expect(dayRow('第 2 組 小芳')).toEqual(['✓✓✗']);
		expect(session.flow!.actions.map((a) => a.successRate?.records.map((r) => [r.who, r.practice]) ?? [])).toEqual([
			[
				['g1', 'runThrough'],
				['g2', 'runThrough']
			],
			[],
			[]
		]);
	});

	it('改過格子按取消先問；選「丟掉」什麼都不存，回到記錄頁；再打開是新的一張', async () => {
		setup();
		await openSheet();
		await tapSlot('第 2 組 小芳', '下法', 2);
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '丟掉' }));

		expect(screen.queryByRole('region', { name: '記一次全上' })).toBeNull();
		expect(dayRow('第 1 組 小美')).toEqual([]);
		expect(dayRow('第 2 組 小芳')).toEqual([]);
		await openSheet();
		expect(sheet().getByRole('button', { name: /^第 2 組 小芳 下法 / }).textContent?.trim()).toBe('✓');
	});

	it('「刪掉上一次全上」：整次拿掉這天最後存的全上（每個動作的都拿掉），分段練留著；「已刪掉」旁按「救回」整次放回去', async () => {
		const session = setup();
		const who = '第 1 組 小美';
		const removeRun = () => screen.getByRole('button', { name: '刪掉上一次全上' });
		const runs = () => session.flow!.actions.flatMap((a) => a.successRate?.records.filter((r) => r.runThroughId) ?? []);
		expect(disabled(removeRun())).toBe(true);
		await tap(who, '上法', '失敗');
		await save(who);
		expect(disabled(removeRun())).toBe(true);
		await openSheet();
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));
		expect(runs()).toHaveLength(4);
		expect(dayRow(who)).toEqual(['✗··', '✓✓✓']);
		expect(disabled(removeRun())).toBe(false);

		await fireEvent.click(removeRun());
		expect(runs()).toEqual([]);
		expect(dayRow(who)).toEqual(['✗··']);
		expect(screen.getByRole('status').textContent).toContain('已刪掉');
		expect(disabled(removeRun())).toBe(true);
		expect(session.canUndo).toBe(false);

		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		expect(runs()).toHaveLength(4);
		expect(dayRow(who)).toEqual(['✗··', '✓✓✓']);
		expect(screen.getByRole('status').textContent).toBe('已救回');
	});
});
