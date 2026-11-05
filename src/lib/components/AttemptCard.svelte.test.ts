// 記錄頁的一張卡：放一個真的 session 進去，點記號，讀 session 的流程。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptWhos, recordAttempt, recordRunThrough } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { libSample, ratedSample } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import AttemptCard from './AttemptCard.svelte';

const DATE = '2026-11-01';

/** 畫第 1 組（小美、小A）的卡（給了 index 就是那個動作的第一張卡），回傳 session。 */
function setup(flow = libSample(), index = 0) {
	const { editor, session } = testEditor(flow);
	const action = flow.actions[index];
	const { who, name, people } = attemptWhos(flow, action)[0];
	render(TestSession, { props: { editor, component: AttemptCard, props: { action, who, name, people, date: DATE } } });
	return { session, name };
}

const records = (session: EditorSession, index = 0) => session.flow!.actions[index].successRate!.records;
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
		await tap(name, '上法', '失敗');
		await save();
		expect(records(session).map((r) => r.marks)).toEqual([{ p1: '✓', p2: '✗' }, { p1: '✗' }]);
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

	it('「整個」照順序點：上法 ✓ 不提醒跳過；只點下法才提醒', async () => {
		const { name } = setup();
		// 還沒點、點了又取消（沒有記號）也不提醒
		expect(screen.queryByText(/跳過了前面的環節/)).toBeNull();
		await tap(name, '上法', '成功');
		expect(screen.queryByText(/跳過了前面的環節/)).toBeNull();
		await tap(name, '上法', '成功');
		expect(screen.queryByText(/跳過了前面的環節/)).toBeNull();
		await tap(name, '下法', '成功');
		expect(screen.getByText(/跳過了前面的環節/)).toBeTruthy();
	});

	it('「整個」按了 ✗：後面環節的按鈕停用，存下來後面空著；取消 ✗ 也不會冒出之前的記號', async () => {
		const { session, name } = setup();
		await tap(name, '下法', '小失誤');
		await tap(name, '上法', '失敗');
		const button = (phase: string) => screen.getByRole('button', { name: `${name} ${phase} 成功` }) as HTMLButtonElement;
		expect([button('中段').disabled, button('下法').disabled]).toEqual([true, true]);
		await tap(name, '上法', '失敗');
		expect(pressed(name, '下法', '小失誤')).toBe('false');
		expect(button('下法').disabled).toBe(false);
		await tap(name, '上法', '失敗');
		await save();
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([[true, { p1: '✗' }]]);
	});

	it('「全部 ✓ 存」：每個環節都成功，存成一次整個做', async () => {
		const { session, name } = setup();
		await tap(name, '中段', '小失誤');
		await fireEvent.click(screen.getByRole('button', { name: '全部 ✓ 存' }));
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([[true, { p1: '✓', p2: '✓', p3: '✓' }]]);
		expect(pressed(name, '中段', '小失誤')).toBe('false');
	});

	it('「只練幾個環節」：點到最後一個選的環節就自動存', async () => {
		const { session, name } = setup();
		await fireEvent.click(screen.getByRole('radio', { name: '只練幾個環節' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: '上法' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: '下法' }));
		expect(screen.queryByRole('button', { name: '存這一次' })).toBeNull();
		expect((screen.getByRole('button', { name: `${name} 中段 成功` }) as HTMLButtonElement).disabled).toBe(true);
		await tap(name, '上法', '成功');
		expect(records(session)).toEqual([]);
		await tap(name, '下法', '小失誤');
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([[false, { p1: '✓', p3: '△' }]]);
		// 選的環節留著，下一次照樣只練這幾個；點了 ✗ 就存
		await tap(name, '上法', '失敗');
		expect(records(session).map((r) => [r.whole, r.marks])).toEqual([
			[false, { p1: '✓', p3: '△' }],
			[false, { p1: '✗' }]
		]);
	});

	it('「只練幾個環節」寫出怎麼用；點環節那一列的空白處也能勾', async () => {
		setup();
		const hint = '勾要練的環節，按完最後一個勾的環節（或按到 ✗）就自動存';
		expect(screen.queryByText(hint)).toBeNull();
		await fireEvent.click(screen.getByRole('radio', { name: '只練幾個環節' }));
		expect(screen.getByText(hint)).toBeTruthy();
		const box = screen.getByRole('checkbox', { name: '中段' }) as HTMLInputElement;
		await fireEvent.click(box.closest('.phase')!);
		expect(box.checked).toBe(true);
		await fireEvent.click(box.closest('.phase')!);
		expect(box.checked).toBe(false);
	});

	it('只練幾個環節的那幾次用淡色框，跟整個做中途 ✗ 分得出來', async () => {
		let flow = flowOf(recordAttempt(libSample(), 'x1', { date: DATE, who: 'g1', practice: 'drill', whole: true, marks: { p1: '✗' } }));
		flow = flowOf(recordAttempt(flow, 'x1', { date: DATE, who: 'g1', practice: 'drill', whole: false, marks: { p1: '✗' } }));
		setup(flow);
		const items = screen.getAllByRole('listitem');
		expect(items.map((li) => [li.textContent, li.classList.contains('partial')])).toEqual([
			['✗··', false],
			['✗··', true]
		]);
		expect(screen.getByRole('button', { name: /^改第 2 次/ }).getAttribute('aria-label')).toBe('改第 2 次（只練幾個環節 ✗··）');
	});

	it('只有一個環節的動作：卡上沒有「整個／只練幾個環節」和存檔鈕，點了記號就存成整個做', async () => {
		const { session, name } = setup(ratedSample(), 1);
		expect(screen.queryByRole('radiogroup')).toBeNull();
		expect(screen.queryByText('只練幾個環節')).toBeNull();
		expect(screen.queryByRole('button', { name: '存這一次' })).toBeNull();
		expect(screen.queryByRole('button', { name: '全部 ✓ 存' })).toBeNull();
		await tap(name, '整體 騰翻', '小失誤');
		expect(records(session, 1).map((r) => [r.whole, r.marks])).toEqual([[true, { p4: '△' }]]);
		expect(screen.getByRole('status').textContent).toBe('已存');
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

	it('刪掉後寫出刪了哪一次和「救回」：按救回放回原位；10 秒後消失，滑鼠在上面時不消失', async () => {
		vi.useFakeTimers();
		const { session } = setup(mixed());
		const before = records(session);
		await removeLast();
		expect(records(session).map((r) => r.id)).toEqual([before[0].id, before[2].id]);
		// 寫出刪了哪一次（這天的第 2 次），用中性色（不是成功的綠字）
		expect(screen.getByRole('status').textContent).toBe('已刪掉 ✗··（第 2 次）救回');
		expect(screen.getByRole('status').classList.contains('removed')).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		expect(records(session)).toEqual(before);
		expect(session.canUndo).toBe(false);

		// 滑鼠移上去停住倒數，移開了把剩下的走完（共 10 秒）
		await removeLast();
		await vi.advanceTimersByTimeAsync(3000);
		await fireEvent.pointerEnter(screen.getByRole('status'));
		await vi.advanceTimersByTimeAsync(30000);
		expect(screen.getByRole('button', { name: '救回' })).toBeTruthy();
		await fireEvent.pointerLeave(screen.getByRole('status'));
		await vi.advanceTimersByTimeAsync(6500);
		expect(screen.getByRole('button', { name: '救回' })).toBeTruthy();
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.queryByRole('button', { name: '救回' })).toBeNull();
	});

	it('點歷史裡的某一次可以改記號：還在原來的位置，寫「已改」；不算復原的一步', async () => {
		const { session } = setup(mixed());
		await fireEvent.click(screen.getByRole('button', { name: /^改第 2 次/ }));
		const edit = within(screen.getByRole('group', { name: '改第 2 次' }));
		expect(edit.getByRole('button', { name: '第 2 次 上法 失敗' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(edit.getByRole('button', { name: '第 2 次 上法 成功' }));
		await fireEvent.click(edit.getByRole('button', { name: '第 2 次 中段 成功' }));
		await fireEvent.click(edit.getByRole('button', { name: '第 2 次 下法 小失誤' }));
		await fireEvent.click(edit.getByRole('button', { name: '存修改' }));

		expect(records(session).map((r) => [r.practice, r.whole, r.marks])).toEqual([
			['runThrough', true, { p1: '✓', p2: '✗' }],
			['drill', true, { p1: '✓', p2: '✓', p3: '△' }],
			['runThrough', true, { p1: '△', p2: '✓', p3: '✓' }]
		]);
		expect(screen.queryByRole('group', { name: '改第 2 次' })).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('已改');
		expect(session.canUndo).toBe(false);
	});

	it('點全上記的那一次也能刪掉（只刪這一次）；「救回」放回原位；按「不改了」什麼都不動', async () => {
		const { session } = setup(mixed());
		const before = records(session);
		await fireEvent.click(screen.getByRole('button', { name: /^改第 1 次/ }));
		await fireEvent.click(screen.getByRole('button', { name: '不改了' }));
		expect(screen.queryByRole('group', { name: '改第 1 次' })).toBeNull();
		expect(records(session)).toBe(before);

		await fireEvent.click(screen.getByRole('button', { name: /^改第 3 次/ }));
		await fireEvent.click(within(screen.getByRole('group', { name: '改第 3 次' })).getByRole('button', { name: '刪掉這一次' }));
		expect(records(session).map((r) => r.id)).toEqual([before[0].id, before[1].id]);
		expect(screen.getByRole('status').textContent).toBe('已刪掉 △✓✓（第 3 次）救回');
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		expect(records(session)).toEqual(before);
	});

	it('全上的那一次改到空了一格：擋下來說原因，紀錄不變', async () => {
		const { session } = setup(mixed());
		const before = records(session);
		await fireEvent.click(screen.getByRole('button', { name: /^改第 3 次/ }));
		const edit = within(screen.getByRole('group', { name: '改第 3 次' }));
		await fireEvent.click(edit.getByRole('button', { name: '第 3 次 中段 成功' }));
		await fireEvent.click(edit.getByRole('button', { name: '存修改' }));
		expect(screen.getByRole('alert').textContent).toBe('全上的一次每個環節都要有記號（✗ 後面的不用）');
		expect(records(session)).toBe(before);
	});

	it('沒有上層的組：標題是主底的名字，下面小字列出全組', () => {
		const flow = libSample();
		// 第 1 組的小美改當後保：組裡沒有上層，主底是小A
		const members = flow.actions[0].members.map((m) => (m.memberId === 'm1' ? { ...m, role: '後保' } : m));
		setup({ ...flow, actions: [{ ...flow.actions[0], members }] });
		const card = screen.getByRole('region', { name: '第 1 組 小A' });
		expect(card.querySelector('header')?.textContent).toContain('小美・小A');
	});
});
