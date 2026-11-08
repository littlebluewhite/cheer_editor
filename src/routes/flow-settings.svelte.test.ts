// 頁面：規則警告和流程設定（#161）。
// 警告一條一行、各有小標題，點了打開流程設定；秒數填 0 被擋、說原因；沒有口號段時寫法中性；
// 恢復預設；在流程設定新增、改名、刪除自訂任務角色。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { addCustomRole, CELL_M, DEFAULT_TIME_RULES, updateTimeRules, type Flow } from '#lib/core';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const warningList = () => screen.getByRole('list', { name: '規則警告' });

async function openSettings() {
	await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
	return screen.getByRole('dialog', { name: '流程設定' });
}

/** teamFlow（只有音樂段）加一個自訂任務角色「中心」，小A 在 Lib 裡是中心。 */
function withCustomRole(): Flow {
	const flow = flowOf(addCustomRole(teamFlow(), { name: '中心', meaning: '站正中間' }));
	return {
		...flow,
		actions: flow.actions.map((a) => ({
			...a,
			members: a.members.map((m) => (m.memberId === 'm2' ? { ...m, role: '中心' } : m))
		}))
	};
}

describe('規則警告', () => {
	it('兩條警告：兩行、各有小標題；點一條打開流程設定', async () => {
		// 只有音樂段（沒有口號段），音樂段上限 1 秒
		render(Page, editorPage(flowOf(updateTimeRules(teamFlow(), { maxMusicSec: 1 }))).props);
		const items = within(warningList()).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(items.map((li) => li.querySelector('b')?.textContent)).toEqual(['還沒有口號段', '音樂段太長']);

		await fireEvent.click(within(items[1]).getByRole('button'));
		expect(screen.getByRole('dialog', { name: '流程設定' })).toBeTruthy();
	});

	it('沒有口號段：不寫「少於 30 秒」', async () => {
		render(Page, editorPage(teamFlow()).props);
		const text = warningList().textContent!;
		expect(text).toContain('還沒有口號段');
		expect(text).not.toContain('少於');
	});
});

describe('流程設定的規則警告', () => {
	it('秒數填 0：被擋，退回原本的值並說原因', async () => {
		render(Page, editorPage(teamFlow()).props);
		const dialog = await openSettings();
		const min = within(dialog).getByLabelText('口號段加起來最少（秒）') as HTMLInputElement;
		await fireEvent.change(min, { target: { value: '0' } });
		expect(min.value).toBe('30');
		expect(within(dialog).getByRole('alert').textContent).toContain('秒數要大於 0');
	});

	it('互相矛盾被擋：口號段最少不能比整支流程最多還多', async () => {
		render(Page, editorPage(teamFlow()).props);
		const dialog = await openSettings();
		await fireEvent.change(within(dialog).getByLabelText('整支流程最多（秒）'), { target: { value: '20' } });
		expect(within(dialog).getByRole('alert').textContent).toMatch(/「整支流程最多」/);
	});

	it('恢復預設：三個數字和開關都回到預設', async () => {
		const page = editorPage(flowOf(updateTimeRules(teamFlow(), { on: false, minChantSec: 10 })));
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.click(within(dialog).getByRole('button', { name: '恢復預設' }));
		expect(page.session.flow!.timeRules).toEqual(DEFAULT_TIME_RULES);
		expect((within(dialog).getByLabelText('口號段加起來最少（秒）') as HTMLInputElement).value).toBe('30');
		expect((within(dialog).getByRole('button', { name: '恢復預設' }) as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('流程設定的自訂任務角色', () => {
	it('改名：動作裡的人跟著改', async () => {
		const page = editorPage(withCustomRole());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.change(within(dialog).getByLabelText('「中心」的名稱'), { target: { value: '正中' } });
		const flow = page.session.flow!;
		expect(flow.customRoles.map((r) => r.name)).toEqual(['正中']);
		expect(flow.actions[0].members.find((m) => m.memberId === 'm2')!.role).toBe('正中');
	});

	it('新增', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('新的自訂任務角色'), { target: { value: '尾巴' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '新增任務角色' }));
		expect(page.session.flow!.customRoles.map((r) => r.name)).toEqual(['尾巴']);
		expect(within(dialog).getByLabelText('「尾巴」的名稱')).toBeTruthy();
	});

	it('刪除有人用的：先列出動作問，確定才刪', async () => {
		const page = editorPage(withCustomRole());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.click(within(dialog).getByRole('button', { name: '刪除任務角色「中心」' }));
		expect(page.session.flow!.customRoles).toHaveLength(1);
		await fireEvent.click(within(dialog).getByRole('button', { name: '確定刪除' }));
		expect(page.session.flow!.customRoles).toEqual([]);
		expect(page.session.flow!.actions[0].members.find((m) => m.memberId === 'm2')!.role).toBeNull();
	});
});

describe('調整場地（#169）', () => {
	const strips = () => document.querySelectorAll('[data-strip-number]').length;
	const SNAPPED = '已調整場地：大家吸附到新格子，改回原本的場地也不會回原位；要回原狀請按復原';

	it('9 條直放改 5 條橫放：場地條數變了；關掉按 ⌘Z 回來', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		expect(strips()).toBe(9);
		const dialog = await openSettings();
		expect(dialog.textContent).not.toContain('建好之後不能換');
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '5' } });
		await fireEvent.click(within(dialog).getByLabelText('橫放'));
		await fireEvent.click(within(dialog).getByRole('button', { name: '調整場地' }));
		expect(page.session.flow!.field).toEqual({ strips: 5, layout: 'horizontal' });
		expect(strips()).toBe(5);

		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(page.session.flow!.field).toEqual({ strips: 9, layout: 'vertical' });
		expect(strips()).toBe(9);
	});

	it('調整好了：說大家吸到新格子、改回去不會回原位，要回原狀按復原（N31）', async () => {
		render(Page, editorPage(teamFlow()).props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '4' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '調整場地' }));
		expect(within(dialog).getByRole('status').textContent).toBe(SNAPPED);
	});

	it('改了場地直接關（關掉就套用）：關掉後提示一樣說改回去不會回原位（N31）', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '4' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		expect(page.session.notice).toBe('已調整場地；大家吸附到新格子，改回原本的場地也不會回原位');
		expect(page.session.noticeButton?.label).toBe('復原');
	});

	it('條數不對：被擋、說原因', async () => {
		render(Page, editorPage(teamFlow()).props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '13' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '調整場地' }));
		expect(within(dialog).getByRole('alert').textContent).toContain('條數要是 1–12 的整數');
	});
});

/** teamFlow 的開頭那張只放小美、小A，相隔一格：9 條改 1 條時寬度縮成 1/9，兩人吸到同一點。 */
function closePair(): Flow {
	const flow = teamFlow();
	return { ...flow, formations: [{ ...flow.formations[0], pos: { m1: [0, 0], m2: [CELL_M, 0] } }] };
}

describe('流程設定：關掉就套用、Enter 套用、改小先提醒（#219）', () => {
	it('改了場地沒按「調整場地」就關：照樣調整', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '5' } });
		await fireEvent.click(within(dialog).getByLabelText('橫放'));
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		expect(page.session.flow!.field).toEqual({ strips: 5, layout: 'horizontal' });
		expect(screen.queryByRole('dialog', { name: '流程設定' })).toBeNull();
	});

	it('關掉時條數不對：不關、退回原本的條數並說原因；再關就關了', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const dialog = await openSettings();
		const input = within(dialog).getByLabelText('條數') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '13' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		expect(screen.getByRole('dialog', { name: '流程設定' })).toBeTruthy();
		expect(within(dialog).getByRole('alert').textContent).toContain('條數要是 1–12 的整數');
		expect(input.value).toBe('9');
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog', { name: '流程設定' })).toBeNull();
		expect(page.session.flow!.field).toEqual({ strips: 9, layout: 'vertical' });
	});

	it('條數欄按 Enter：調整場地', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const dialog = await openSettings();
		const input = within(dialog).getByLabelText('條數');
		input.focus();
		await fireEvent.input(input, { target: { value: '7' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(page.session.flow!.field).toEqual({ strips: 7, layout: 'vertical' });
	});

	it('流程名字、秒數欄按 Enter：套用', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const dialog = await openSettings();
		const name = within(dialog).getByLabelText('流程名字');
		name.focus();
		await fireEvent.input(name, { target: { value: '決賽' } });
		await fireEvent.keyDown(name, { key: 'Enter' });
		expect(page.session.flow!.name).toBe('決賽');
		const total = within(dialog).getByLabelText('整支流程最多（秒）');
		total.focus();
		await fireEvent.input(total, { target: { value: '150' } });
		await fireEvent.keyDown(total, { key: 'Enter' });
		expect(page.session.flow!.timeRules.maxTotalSec).toBe(150);
	});

	it('改小會讓人疊在一起：先列出哪張站位誰疊在一起，按「照樣調整」才調整', async () => {
		const page = editorPage(closePair());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '1' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '調整場地' }));
		expect(page.session.flow!.field.strips).toBe(9);
		expect(dialog.textContent).toContain('會疊在同一點');
		expect(dialog.textContent).toContain('站位 1：小美、小A');
		await fireEvent.click(within(dialog).getByRole('button', { name: '照樣調整' }));
		expect(page.session.flow!.field.strips).toBe(1);
	});

	it('改小會疊人時直接關：先問、不關；取消就退回原本的條數', async () => {
		const page = editorPage(closePair());
		render(Page, page.props);
		const dialog = await openSettings();
		const input = within(dialog).getByLabelText('條數') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '1' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		expect(screen.getByRole('dialog', { name: '流程設定' })).toBeTruthy();
		expect(dialog.textContent).toContain('會疊在同一點');
		await fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
		expect(input.value).toBe('9');
		expect(page.session.flow!.field.strips).toBe(9);
	});

	it('疊人的確認框開著時按 ×：不調整、對話框就關了，不會默默把條數改回去還要再按一次 ×（N39）', async () => {
		const page = editorPage(closePair());
		render(Page, page.props);
		const dialog = await openSettings();
		await fireEvent.input(within(dialog).getByLabelText('條數'), { target: { value: '1' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '調整場地' }));
		expect(dialog.textContent).toContain('會疊在同一點');
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog', { name: '流程設定' })).toBeNull();
		expect(page.session.flow!.field.strips).toBe(9);
	});

	it('疊人的確認框開著時按 Esc：只收掉確認框、條數退回，對話框還開著', async () => {
		const page = editorPage(closePair());
		render(Page, page.props);
		const dialog = await openSettings();
		const input = within(dialog).getByLabelText('條數') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '1' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '調整場地' }));
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(dialog.textContent).not.toContain('會疊在同一點');
		expect(input.value).toBe('9');
		expect(screen.getByRole('dialog', { name: '流程設定' })).toBeTruthy();
	});
});

describe('點規則警告帶到出問題的地方、關掉的警告看得出來（#219）', () => {
	it('點「音樂段太長」：打開流程設定，焦點在「音樂段加起來最多」', async () => {
		render(Page, editorPage(flowOf(updateTimeRules(teamFlow(), { maxMusicSec: 1 }))).props);
		const item = within(warningList())
			.getAllByRole('listitem')
			.find((li) => li.textContent!.includes('音樂段太長'))!;
		await fireEvent.click(within(item).getByRole('button'));
		const dialog = screen.getByRole('dialog', { name: '流程設定' });
		expect(document.activeElement).toBe(within(dialog).getByLabelText('音樂段加起來最多（秒）'));
	});

	it('點「還沒有口號段」：焦點在「口號段加起來最少」', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(within(warningList()).getByRole('button'));
		const dialog = screen.getByRole('dialog', { name: '流程設定' });
		expect(document.activeElement).toBe(within(dialog).getByLabelText('口號段加起來最少（秒）'));
	});

	it('關掉的規則警告：左邊欄寫「規則警告關著」，點了到流程設定的開關', async () => {
		render(Page, editorPage(flowOf(updateTimeRules(teamFlow(), { on: false }))).props);
		expect(screen.queryByRole('list', { name: '規則警告' })).toBeNull();
		const off = screen.getByRole('button', { name: /規則警告關著/ });
		expect(off.textContent).toContain('流程設定');
		await fireEvent.click(off);
		const dialog = screen.getByRole('dialog', { name: '流程設定' });
		expect(document.activeElement).toBe(within(dialog).getByRole('checkbox', { name: /規則警告/ }));
		expect(dialog.textContent).toContain('關著');
	});
});
