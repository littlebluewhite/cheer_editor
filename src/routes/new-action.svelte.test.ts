// 頁面：新動作表單（右邊欄沒選動作時）。打的字留得住、Enter 送出、新增後播放頭跳到動作結束。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { addSegment, segmentSpans, setSquad } from '#lib/core';
import { editorPage, phasedFlow, teamFlow } from '#lib/test-fakes.js';
import { flowOf, squadNumbers } from '#lib/test-flows.js';
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
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
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
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
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

	it('新增後沒有選到的人：場上、泳道名字都沒選，下一次拖人不會整隊一起走', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		expect(page.session.selectedMemberIds.length).toBeGreaterThan(1);
		await fireEvent.input(field('開始'), { target: { value: '3-1' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		expect(page.session.flow!.actions).toHaveLength(2);
		expect(page.session.selectedMemberIds).toEqual([]);
		expect(document.querySelectorAll('[data-member-id][aria-pressed="true"]')).toHaveLength(0);
		expect(document.querySelectorAll('[data-lane] .lab[aria-pressed="true"]')).toHaveLength(0);
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

describe('新動作表單：選到人才打開（#214）', () => {
	it('沒選人時只有「＋ 新動作」；選了人表單打開，取消選人又收起來', async () => {
		render(Page, editorPage(teamFlow()).props);
		expect(screen.queryByLabelText('名稱')).toBeNull();
		expect(screen.queryByRole('button', { name: '新增動作' })).toBeNull();
		expect(screen.getByRole('button', { name: '＋ 新動作' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		expect(field('名稱')).toBeTruthy();
		expect(screen.getByRole('button', { name: '新增動作' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '＋ 新動作' })).toBeNull();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByLabelText('名稱')).toBeNull();
		expect(screen.getByRole('button', { name: '＋ 新動作' })).toBeTruthy();
	});

	it('按「＋ 新動作」：沒選人也打開表單，名稱有焦點', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
		expect(document.activeElement).toBe(field('名稱'));
		expect((screen.getByRole('button', { name: '新增動作' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('選了動作按「開新的動作表單」：表單直接打開，不用再按一次', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(screen.getByRole('button', { name: '開新的動作表單' }));
		expect(field('名稱')).toBeTruthy();
	});
});

describe('新動作表單：開始的寫法跟著段', () => {
	it('在音樂段打了開始 3-1，播放頭移到口號段：開始換成秒，按新增成功', async () => {
		const page = editorPage(flowOf(addSegment(teamFlow(), 'chant')));
		render(Page, page.props);
		await fireEvent.click(screen.getByRole('button', { name: /全隊/ }));
		await fireEvent.input(field('開始'), { target: { value: '3-1' } });
		await fireEvent.change(field('開始'));
		page.editor.playback.seek(segmentSpans(page.session.flow!)[1].startSec + 1);
		await tick();
		expect(field('開始').value).toBe('1.0');
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		const added = page.session.flow!.actions[1];
		expect(added).toMatchObject({ segmentId: 's2', start: 10 });
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
		await fireEvent.click(screen.getByRole('button', { name: '＋ 新動作' }));
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

describe('接下一個動作', () => {
	/** Lib（第 1 個八拍，有環節）分 3 組：小美、小A 第 1 組，小芳第 2 組，小B 第 3 組。 */
	function threeSquads() {
		let flow = phasedFlow();
		for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 3]] as const) {
			flow = flowOf(setSquad(flow, 'x1', [id], squad));
		}
		return flow;
	}
	/** 表單上每個人和任務角色。 */
	const roles = () =>
		screen.getAllByRole('combobox', { name: /的任務角色$/ }).map((el) => `${el.getAttribute('aria-label')}：${el.textContent?.trim()}`);

	it('選 Lib 按接下一個動作：新表單開始是 Lib 的結束拍，人和任務角色一樣', async () => {
		render(Page, editorPage(threeSquads()).props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(screen.getByRole('button', { name: '接下一個動作' }));
		expect(screen.queryByRole('button', { name: '開新的動作表單' })).toBeNull();
		expect(field('開始').value).toBe('2-1');
		expect(field('名稱').value).toBe('');
		expect(roles()).toEqual(['小美 的任務角色：上層', '小A 的任務角色：主底', '小芳 的任務角色：上層', '小B 的任務角色：主底']);
	});

	it('新增後加第一個環節：組跟 Lib 一樣', async () => {
		const page = editorPage(threeSquads());
		render(Page, page.props);
		await fireEvent.click(document.querySelector('[data-action-id="x1"]')!);
		await fireEvent.click(screen.getByRole('button', { name: '接下一個動作' }));
		await fireEvent.input(field('名稱'), { target: { value: '金字塔' } });
		await fireEvent.click(screen.getByRole('button', { name: '新增動作' }));
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '2-1' }));
		await fireEvent.click(grid.getByRole('button', { name: '2-4' }), { shiftKey: true });
		const pop = within(within(screen.getByRole('dialog', { name: '拍點小窗' })).getByRole('group', { name: '環節' }));
		await fireEvent.change(pop.getByRole('combobox', { name: '環節的種類' }), { target: { value: 'load' } });
		await fireEvent.click(pop.getByRole('button', { name: '加入環節' }));
		const pyramid = page.session.flow!.actions[1];
		expect(pyramid.name).toBe('金字塔');
		expect(pyramid.successRate?.phases).toHaveLength(1);
		expect(squadNumbers(pyramid)).toEqual([1, 1, 2, 3]);
		expect(pyramid.members.map((m) => m.role)).toEqual(['上層', '主底', '上層', '主底']);
	});
});
