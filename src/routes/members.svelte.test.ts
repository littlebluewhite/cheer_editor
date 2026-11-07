// 隊員名單（#154）：貼上名單比較寬鬆、改名失敗的錯誤畫在那一列下面、刪人的確認寫清楚、打號碼排順序。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addMembers, type Flow } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView：記下被捲過去的元素。
const scrolled: Element[] = [];
Element.prototype.scrollIntoView = function () {
	scrolled.push(this);
};

/** 等畫面跑一格（捲過去是等下一格才捲）。 */
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** 打開流程，切到隊員分頁。 */
async function setup(flow: Flow = libSample()) {
	const { session, props } = editorPage(flow);
	render(Page, props);
	await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
	return session;
}

/** 在加隊員的名字框貼上 text，按「加隊員」（性別、全局角色不選）。 */
async function paste(text: string) {
	await fireEvent.input(screen.getByLabelText(/^名字/), { target: { value: text } });
	await fireEvent.click(screen.getByRole('button', { name: '加隊員' }));
}

/** libSample 再加阿強（底層，第 5 個）。 */
const five = () => flowOf(addMembers(libSample(), [{ name: '阿強', gender: 'M', globalRole: 'base' }]));

describe('貼上名單', () => {
	it('用空白或逗號分隔的三欄：每個人用自己那一行的性別和全局角色', async () => {
		const session = await setup();
		await paste('小明 男 底層\n小美美,女,上層');
		expect(screen.queryByRole('alert')).toBeNull();
		expect(session.flow!.members.slice(4)).toMatchObject([
			{ name: '小明', gender: 'M', globalRole: 'base' },
			{ name: '小美美', gender: 'F', globalRole: 'top' }
		]);
	});

	it('有標題列的三欄：標題列不會變成隊員，也不算錯', async () => {
		const session = await setup();
		await paste('名字\t性別\t全局角色\n小明\t男\t底層');
		expect(screen.queryByRole('alert')).toBeNull();
		expect(session.flow!.members.slice(4).map((m) => m.name)).toEqual(['小明']);
	});
});

describe('改名字被擋下', () => {
	it('原因畫在那一列下面，不捲到加隊員表單', async () => {
		await setup();
		const input = screen.getByLabelText('第 2 位隊員的名字') as HTMLInputElement;
		scrolled.length = 0;
		await fireEvent.change(input, { target: { value: '  ' } });
		const alert = screen.getByRole('alert');
		expect(alert.closest('li')).toBe(document.querySelectorAll('.members li')[1]);
		expect(alert.textContent).toBe('請填隊員名字');
		expect(input.value).toBe('小A');
		await frame();
		expect(scrolled.every((el) => el.closest('li'))).toBe(true);
	});

	it('之後加隊員被擋下：原因回到加隊員表單下面', async () => {
		await setup();
		await fireEvent.change(screen.getByLabelText('第 2 位隊員的名字'), { target: { value: '' } });
		await paste('小C 男孩 底層');
		expect(screen.getByRole('alert').closest('li')).toBeNull();
	});
});

describe('刪隊員的確認', () => {
	it('刪一個在 Lib 當上層的人：寫 Lib 他那一組會沒有上層、號碼會遞補，列出他在各動作裡的任務角色', async () => {
		await setup(five());
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
		const box = screen.getByRole('alertdialog');
		expect(box.textContent).toContain('「技巧·Lib」第 1 組會沒有上層');
		expect(box.textContent).toContain('後面 4 個人的號碼會往前遞補');
		expect(box.textContent).toContain('動作「技巧·Lib」（音樂 1 1-1 起）：他是第 1 組的上層');
	});
});

describe('打號碼排順序', () => {
	const names = () => [...document.querySelectorAll<HTMLInputElement>('.members li input[aria-label$="的名字"]')].map((i) => i.value);

	it('把第 5 個人的號碼改成 1：他變第一個，可以復原', async () => {
		const session = await setup(five());
		await fireEvent.click(screen.getByRole('button', { name: '改第 5 位隊員的號碼' }));
		const no = screen.getByLabelText('第 5 位隊員的號碼') as HTMLInputElement;
		expect(document.activeElement).toBe(no);
		await fireEvent.change(no, { target: { value: '1' } });
		expect(names()).toEqual(['阿強', '小美', '小A', '小B', '小芳']);
		expect(screen.queryByLabelText(/^第 \d+ 位隊員的號碼$/)).toBeNull();
		session.undo();
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小美', '小A', '小B', '小芳', '阿強']);
	});

	it('打超過人數就排到最後；打的不是號碼、按 Esc 就不動', async () => {
		const session = await setup(five());
		await fireEvent.click(screen.getByRole('button', { name: '改第 1 位隊員的號碼' }));
		await fireEvent.change(screen.getByLabelText('第 1 位隊員的號碼'), { target: { value: '99' } });
		expect(names()).toEqual(['小A', '小B', '小芳', '阿強', '小美']);
		await fireEvent.click(screen.getByRole('button', { name: '改第 1 位隊員的號碼' }));
		await fireEvent.change(screen.getByLabelText('第 1 位隊員的號碼'), { target: { value: 'abc' } });
		await fireEvent.click(screen.getByRole('button', { name: '改第 1 位隊員的號碼' }));
		await fireEvent.keyDown(screen.getByLabelText('第 1 位隊員的號碼'), { key: 'Escape' });
		expect(screen.queryByLabelText('第 1 位隊員的號碼')).toBeNull();
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小A', '小B', '小芳', '阿強', '小美']);
	});

	it('改號碼時按 Esc：焦點回到那一列的圓圈，不掉到整個頁面（#205）', async () => {
		await setup(five());
		const circle = () => screen.getByRole('button', { name: '改第 3 位隊員的號碼' });
		circle().focus();
		await fireEvent.click(circle());
		const no = screen.getByLabelText('第 3 位隊員的號碼');
		expect(document.activeElement).toBe(no);
		await fireEvent.keyDown(no, { key: 'Escape' });
		await frame();
		expect(screen.queryByLabelText('第 3 位隊員的號碼')).toBeNull();
		expect(document.activeElement).toBe(circle());
	});

	it('在圓圈上按空白鍵：打開號碼欄，不播放', async () => {
		await setup(five());
		const circle = screen.getByRole('button', { name: '改第 2 位隊員的號碼' });
		circle.focus();
		await fireEvent.keyDown(circle, { key: ' ' });
		expect(document.activeElement).toBe(screen.getByLabelText('第 2 位隊員的號碼'));
		expect(screen.queryByRole('button', { name: '暫停' })).toBeNull();
	});
});

describe('加隊員表單', () => {
	it('滿 40 人：名字、性別、全局角色、加隊員鈕都停用，寫為什麼；刪掉一個人就能再加', async () => {
		const people = Array.from({ length: 36 }, (_, i) => ({ name: `隊員${i + 1}`, gender: 'F' as const, globalRole: 'top' as const }));
		await setup(flowOf(addMembers(libSample(), people)));
		const form = screen.getByRole('button', { name: '加隊員' }).closest('form')!;
		const fields = () => [...form.querySelectorAll('textarea, select, button')];
		expect(fields().every((el) => el.matches(':disabled'))).toBe(true);
		expect(form.textContent).toContain('已經 40 人了（一支流程最多 40 人），刪掉隊員才能再加');
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 40 位隊員' }));
		await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		expect(fields().some((el) => el.matches(':disabled'))).toBe(false);
		expect(form.textContent).not.toContain('刪掉隊員才能再加');
	});
});
