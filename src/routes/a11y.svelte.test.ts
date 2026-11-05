// 只用鍵盤和螢幕報讀器也能用（#165）：加段選單、焦點不掉回 body、landmark、場地是一群隊員。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addMembers, type Flow } from '#lib/core';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 頁面放範例流程：音樂 1（4 個八拍）、小美、小A、小B、小芳，動作 Lib。 */
function setup(flow: Flow = libSample()) {
	const { session, props } = editorPage(flow);
	render(Page, props);
	return session;
}

describe('加段選單', () => {
	it('打開時焦點在第一項；上下鍵換項；Esc 關掉，焦點回到「＋」', async () => {
		setup();
		const plus = screen.getByRole('button', { name: '在最後加一段' });
		plus.focus();
		await fireEvent.click(plus);
		const items = screen.getAllByRole('menuitem');
		expect(items.map((b) => b.textContent)).toEqual(['＋音樂段', '＋口號段']);
		expect(document.activeElement).toBe(items[0]);
		await fireEvent.keyDown(items[0], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items[1]);
		await fireEvent.keyDown(items[1], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items[0]);
		await fireEvent.keyDown(items[0], { key: 'ArrowUp' });
		expect(document.activeElement).toBe(items[1]);
		await fireEvent.keyDown(items[1], { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(plus);
	});

	it('選「＋音樂段」加一段、關掉打開的段設定：焦點回到「＋」', async () => {
		setup();
		const plus = screen.getByRole('button', { name: '在最後加一段' });
		await press(plus);
		await press(screen.getByRole('menuitem', { name: '＋音樂段' }));
		await press(screen.getByRole('button', { name: '關閉' }));
		await Promise.resolve();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(plus);
	});
});

/** 焦點在 el 上按它（真的點按鈕時焦點也會先到它身上）。 */
async function press(el: HTMLElement) {
	el.focus();
	await fireEvent.click(el);
}

describe('按鈕消失後焦點不掉回 body', () => {
	/** libSample 再加阿強（第 5 個，沒在任何動作裡）。 */
	const five = () => flowOf(addMembers(libSample(), [{ name: '阿強', gender: 'M', globalRole: 'base' }]));
	const removeButton = (n: number) => screen.getByRole('button', { name: `刪除第 ${n} 位隊員` });

	async function remove(n: number) {
		await press(removeButton(n));
		await press(screen.getByRole('button', { name: '確定刪除' }));
	}

	it('刪掉一個隊員：焦點在補上來的那一列；刪掉最後一個：焦點在上一列', async () => {
		setup(five());
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await remove(2);
		expect(screen.queryByDisplayValue('小A')).toBeNull();
		expect(document.activeElement).toBe(removeButton(2));
		await remove(4);
		expect(screen.queryByDisplayValue('阿強')).toBeNull();
		expect(document.activeElement).toBe(removeButton(3));
	});

	it('刪隊員按取消：焦點回到那一列的刪除鈕', async () => {
		setup(five());
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await press(removeButton(2));
		await press(screen.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(document.activeElement).toBe(removeButton(2));
	});

	it('按「刪除動作」：焦點在動作表單的名稱', async () => {
		setup();
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		await press(screen.getByRole('button', { name: '刪除動作' }));
		expect(screen.queryByRole('button', { name: '刪除動作' })).toBeNull();
		expect(document.activeElement).toBe(screen.getByLabelText('名稱'));
	});

	it('按「新增動作」：焦點在新動作的名稱', async () => {
		setup(teamFlow());
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		await fireEvent.input(screen.getByLabelText('開始'), { target: { value: '3-1' } });
		await press(screen.getByRole('button', { name: '新增動作' }));
		expect(screen.queryByRole('button', { name: '新增動作' })).toBeNull();
		expect(document.activeElement).toBe(screen.getByLabelText('名稱'));
	});

	it('按「接下一個動作」：焦點在新動作的名稱', async () => {
		setup();
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		await press(screen.getByRole('button', { name: /接下一個動作/ }));
		expect(screen.queryByRole('button', { name: /接下一個動作/ })).toBeNull();
		expect(document.activeElement).toBe(screen.getByLabelText('名稱'));
	});
});

describe('動作表單的 Tab 順序', () => {
	it('「刪除動作」排在表單最後：在名稱按 Tab 不會先到它', async () => {
		setup();
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		const form = document.querySelector('.action-form')!;
		const tabbables = [...form.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')].filter(
			(el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0
		);
		expect(tabbables[0]).toBe(screen.getByLabelText('名稱'));
		expect(tabbables.at(-1)).toBe(screen.getByRole('button', { name: '刪除動作' }));
	});
});

describe('landmark 和跳到時間軸', () => {
	it('上方列、場地、右邊欄、時間軸各是一塊 landmark', () => {
		setup();
		// 測試工具不管 header 在不在 section 裡，表單的 header 也算 banner：只看上方列有沒有在裡面。
		expect(screen.getAllByRole('banner')).toContain(document.querySelector('.topbar'));
		expect(screen.getByRole('main')).toBeTruthy();
		expect(screen.getByRole('complementary', { name: '右邊欄' })).toBeTruthy();
		expect(screen.getByRole('region', { name: '時間軸' })).toBeTruthy();
	});

	it('編輯畫面第一個 Tab 停的是「跳到時間軸」；按了焦點到時間軸，再 Tab 就是「在最後加一段」', async () => {
		setup();
		const first = document.querySelector<HTMLElement>('.editor :is(a[href], button, input, select, textarea, [tabindex="0"])')!;
		expect(first.textContent).toBe('跳到時間軸');
		await press(first);
		const timeline = screen.getByRole('region', { name: '時間軸' });
		expect(document.activeElement).toBe(timeline);
		expect(timeline.querySelector('button')).toBe(screen.getByRole('button', { name: '在最後加一段' }));
	});
});

describe('場地給螢幕報讀器', () => {
	it('場地是一群（group）隊員，不是圖片；每個人的名字帶著位置', () => {
		setup();
		expect(screen.queryByRole('img', { name: '場地' })).toBeNull();
		const field = screen.getByRole('group', { name: '場地' });
		const dots = within(field).getAllByRole('button', { name: /^(小美|小A|小B|小芳)　/ });
		expect(dots).toHaveLength(4);
		for (const d of dots) expect(d.getAttribute('aria-label')).toMatch(/　第 \d+ 條 .+｜正面起第 \d+ 格/);
	});
});
