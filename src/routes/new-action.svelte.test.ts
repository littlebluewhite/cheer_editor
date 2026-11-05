// 頁面：新動作表單（右邊欄沒選動作時）。打的字留得住、Enter 送出、新增後播放頭跳到動作結束。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

/** 等畫面跑一格（播放頭在 requestAnimationFrame 裡更新）。 */
async function nextFrame() {
	await new Promise((r) => requestAnimationFrame(() => r(null)));
	await tick();
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe('新動作表單：播放中', () => {
	it('在開始欄打 3-1：播放頭再走幾拍，欄位還是 3-1', async () => {
		const engine = createFakeEngine();
		render(Page, editorPage(teamFlow(), { createEngine: () => engine }).props);
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		engine.audible = engine.clicks[0].when + 0.4;
		await nextFrame();
		expect(field('開始').value).toBe('1-2');
		field('開始').focus();
		await fireEvent.focus(field('開始'));
		await fireEvent.input(field('開始'), { target: { value: '3-1' } });
		engine.audible = engine.clicks[0].when + 2;
		await nextFrame();
		expect(field('開始').value).toBe('3-1');
	});

	it('只是點進開始欄：有焦點時也不跟著播放頭變；離開欄位後再跟著走', async () => {
		const engine = createFakeEngine();
		render(Page, editorPage(teamFlow(), { createEngine: () => engine }).props);
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		field('開始').focus();
		await fireEvent.focus(field('開始'));
		engine.audible = engine.clicks[0].when + 0.8;
		await nextFrame();
		expect(field('開始').value).toBe('1-1');
		field('開始').blur();
		await fireEvent.blur(field('開始'));
		engine.audible = engine.clicks[0].when + 1.6;
		await nextFrame();
		expect(field('開始').value).toBe('1-5');
	});
});

describe('新動作表單：送出', () => {
	it.each(['名稱', '開始', '長度'])('在%s欄按 Enter：動作新增；選字中的 Enter 不算', async (name) => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		await fireEvent.input(field('開始'), { target: { value: '3-1' } });
		await fireEvent.keyDown(field(name), { key: 'Enter', isComposing: true });
		expect(page.session.flow!.actions).toHaveLength(1);
		await fireEvent.keyDown(field(name), { key: 'Enter' });
		expect(page.session.flow!.actions).toHaveLength(2);
		expect(screen.getByRole('button', { name: '開新的動作表單' })).toBeTruthy();
	});

	it('新增後播放頭跳到新動作結束；下一張新表單的開始接在後面', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		await fireEvent.input(field('開始'), { target: { value: '2-1' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-1');
		await fireEvent.click(screen.getByRole('button', { name: '開新的動作表單' }));
		expect(field('開始').value).toBe('3-1');
	});
});

describe('換大類', () => {
	it('動作換大類：提示可以換成新大類的預設任務角色，按了全部換掉；不按就不動', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.change(screen.getByLabelText('大類'), { target: { value: 'tumbling' } });
		expect(page.session.flow!.actions[0].members.map((m) => m.role)).toEqual(['上層', '主底', '上層', '主底']);
		await fireEvent.click(screen.getByRole('button', { name: '換成騰翻的預設任務角色' }));
		expect(page.session.flow!.actions[0].members.map((m) => m.role)).toEqual(['騰翻', '騰翻', '騰翻', '騰翻']);
		expect(screen.queryByRole('button', { name: '換成騰翻的預設任務角色' })).toBeNull();
	});

	it('任務角色已經是新大類的預設值：不用提示', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		await fireEvent.change(screen.getByLabelText('大類'), { target: { value: 'tumbling' } });
		expect(screen.queryByRole('button', { name: /預設任務角色/ })).toBeNull();
	});
});

describe('新動作表單：打到一半的內容', () => {
	it('打了名稱和開始，點別的動作再回到新表單：名稱、開始都還在', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.input(field('名稱'), { target: { value: '金字塔' } });
		await fireEvent.input(field('開始'), { target: { value: '3-1' } });
		await fireEvent.change(field('開始'));
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		expect(field('名稱').value).toBe('Lib');
		await fireEvent.click(screen.getByRole('button', { name: '開新的動作表單' }));
		expect(field('名稱').value).toBe('金字塔');
		expect(field('開始').value).toBe('3-1');
	});

	it('復原「新增動作」：回到新表單，名稱和開始都回來；新增後再開新表單是空白的', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		await fireEvent.input(field('名稱'), { target: { value: '金字塔' } });
		await fireEvent.input(field('開始'), { target: { value: '3-1' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(field('名稱').value).toBe('金字塔');
		await fireEvent.click(screen.getByRole('button', { name: /^復原/ }));
		expect(screen.queryByRole('button', { name: '開新的動作表單' })).toBeNull();
		expect(field('名稱').value).toBe('金字塔');
		expect(field('開始').value).toBe('3-1');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		await fireEvent.click(screen.getByRole('button', { name: '開新的動作表單' }));
		expect(field('名稱').value).toBe('');
	});
});
