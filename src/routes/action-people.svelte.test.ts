// 頁面：選人區和動作表單裡的人（#155）。
// 「沿用上一個動作的人」的提示跟著選取、選不到人寫原因、撞到別的動作的人標出來並可以一次拿掉、
// 最後一段超過段尾寫最多幾拍、從任務角色選單新增的自訂角色套給那個人、把選的人一次加進動作。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { actionSeconds, addMembers } from '#lib/core';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const dot = (id: string) => document.querySelector<SVGGElement>(`[data-member-id="${id}"]`)!;

/** teamFlow 再加三個沒在動作裡的人：小C、小D、小E（m5 到 m7）。 */
function biggerTeam() {
	return flowOf(
		addMembers(teamFlow(), [
			{ name: '小C', gender: 'M', globalRole: 'base' },
			{ name: '小D', gender: 'M', globalRole: 'base' },
			{ name: '小E', gender: 'F', globalRole: 'top' }
		])
	);
}

describe('選人區的提示', () => {
	it('按「沿用上一個動作的人」再改選：「選了…」那行不見', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		const flow = page.session.flow!;
		page.editor.playback.seek(actionSeconds(flow, flow.actions[0]).endSec);
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: '沿用上一個動作的人' }));
		expect(screen.getByRole('status').textContent).toContain('選了「技巧·Lib」的 4 人');
		await fireEvent.click(screen.getByRole('button', { name: '全部上層' }));
		expect(screen.queryByText(/選了「技巧·Lib」/)).toBeNull();
	});

	it('這一拍每個人都在動作裡：寫原因', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '這一拍沒在動作裡的人' }));
		expect(screen.getByRole('status').textContent).toBe('這一拍每個人都在動作裡');
	});
});

describe('撞到別的動作的人', () => {
	it('全隊被擋：清單標出撞到的人，按「拿掉這幾個人」→ 剩下的人可以建動作', async () => {
		const page = editorPage(biggerTeam());
		render(Page, page.props);
		await fireEvent.click(screen.getByRole('button', { name: '全隊' }));
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(page.session.flow!.actions).toHaveLength(1);
		const form = document.querySelector<HTMLElement>('.action-form')!;
		expect(within(form).getAllByText('在「技巧·Lib」裡')).toHaveLength(4);
		await fireEvent.click(screen.getByRole('button', { name: '拿掉這幾個人' }));
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		const actions = page.session.flow!.actions;
		expect(actions).toHaveLength(2);
		expect(actions[1].members.map((m) => m.memberId)).toEqual(['m5', 'm6', 'm7']);
	});

	it('「＋加人…」的選項標出同一時間在別的動作裡的人', async () => {
		render(Page, editorPage(biggerTeam()).props);
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
		const options = within(screen.getByLabelText('加人')).getAllByRole('option').map((o) => o.textContent);
		expect(options).toContain('小美（在「技巧·Lib」裡）');
		expect(options).toContain('小C');
	});
});

describe('最後一段', () => {
	it('超過段尾：訊息寫最多幾拍', async () => {
		render(Page, editorPage(biggerTeam()).props);
		await fireEvent.click(screen.getByRole('button', { name: '這一拍沒在動作裡的人' }));
		await fireEvent.input(field('開始'), { target: { value: '4-1' } });
		await fireEvent.input(field('長度'), { target: { value: '16' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(screen.getByRole('alert').textContent).toBe('超過這段的結尾，最多 8 拍');
	});
});

describe('從任務角色選單新增自訂任務角色', () => {
	it('新角色直接套給打開選單的那個人', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(screen.getByRole('combobox', { name: '小A 的任務角色' }));
		await fireEvent.click(screen.getByRole('option', { name: '＋自訂任務角色…' }));
		const dialog = screen.getByRole('dialog', { name: '名詞對照表' });
		await fireEvent.input(within(dialog).getByLabelText('任務角色名稱'), { target: { value: '飛人' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '新增任務角色' }));
		expect(page.session.flow!.actions[0].members[1]).toEqual({ memberId: 'm2', role: '飛人' });
	});
});

describe('把選的人加進動作', () => {
	it('場上選 3 人、按「把選的 3 人加進來」→ 動作裡多 3 人', async () => {
		const page = editorPage(biggerTeam());
		render(Page, page.props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		for (const id of ['m5', 'm6', 'm7']) await fireEvent.keyDown(dot(id), { key: 'Enter', shiftKey: true });
		await fireEvent.click(screen.getByRole('button', { name: '把選的 3 人加進來' }));
		const x1 = page.session.flow!.actions[0];
		expect(x1.members.map((m) => m.memberId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
		expect(screen.queryByRole('button', { name: /把選的/ })).toBeNull();
	});
});

describe('一次設好幾個人的任務角色（#229）', () => {
	const form = () => document.querySelector<HTMLElement>('.action-form')!;
	const row = (name: string) => within(form()).getByRole('button', { name });
	const rolesOf = (page: ReturnType<typeof editorPage>) => page.session.flow!.actions[0].members.map((m) => m.role);

	it('Shift 點選 3 人、選「側底」→ 3 人都是側底；⌘Z 一步回去', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(row('小美'));
		await fireEvent.click(row('小A'), { shiftKey: true });
		await fireEvent.click(row('小B'), { shiftKey: true });
		expect(within(form()).getByRole('note', { name: '一起設任務角色' }).textContent).toContain('選了 3 人');
		await fireEvent.click(screen.getByRole('combobox', { name: '小A 的任務角色' }));
		await fireEvent.click(screen.getByRole('option', { name: /^側底/ }));
		expect(rolesOf(page)).toEqual(['側底', '側底', '上層', '側底']);
		// 焦點還在剛選的任務角色選單上
		await fireEvent.keyDown(screen.getByRole('combobox', { name: '小A 的任務角色' }), { key: 'z', metaKey: true });
		expect(rolesOf(page)).toEqual(['上層', '主底', '上層', '主底']);
	});

	it('沒按 Shift 點名字只選那一個；選到以外的人改角色只改他自己', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(row('小美'));
		await fireEvent.click(row('小A'), { shiftKey: true });
		await fireEvent.click(row('小B'));
		expect(row('小B').getAttribute('aria-pressed')).toBe('true');
		expect(row('小美').getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(screen.getByRole('combobox', { name: '小芳 的任務角色' }));
		await fireEvent.click(screen.getByRole('option', { name: /^側底/ }));
		expect(rolesOf(page)).toEqual(['上層', '主底', '側底', '主底']);
	});

	it('Shift 再點一次選到的人：從選取拿掉', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(row('小美'));
		await fireEvent.click(row('小A'), { shiftKey: true });
		await fireEvent.click(row('小A'), { shiftKey: true });
		expect(row('小A').getAttribute('aria-pressed')).toBe('false');
		expect(within(form()).queryByRole('note', { name: '一起設任務角色' })).toBeNull();
	});
});

describe('從別的動作複製人', () => {
	it('旁邊寫清楚會連組一起帶過來', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
		const copy = screen.getByRole('combobox', { name: '從別的動作複製人' });
		const desc = document.getElementById(copy.getAttribute('aria-describedby') ?? '');
		expect(desc?.textContent).toContain('會連組一起帶過來');
	});
});
