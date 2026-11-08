// 跟第 [_] 張一樣、站位卡片 ⌘C／⌘V（#224）：都跟拖人走同一條路（自動插站位、往後帶、一步復原）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { deleteMember, insertFormation, setPositions, type Flow } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（點場上的人，泳道會捲過去）。
Element.prototype.scrollIntoView = () => {};

const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
const toolbar = () => screen.getByRole('toolbar', { name: '選人工具列' });
const thumbs = () => screen.queryAllByRole('button', { name: /^站位 \d+$/ });

async function click(id: string, shiftKey = false) {
	await fireEvent.pointerDown(dot(id), { clientX: 0, clientY: 0, button: 0, shiftKey });
	await fireEvent.pointerUp(dot(id), { clientX: 0, clientY: 0, shiftKey });
}

/** 三張站位：開頭、4 秒、8 秒；8 秒那張（站位 3）大家都往前一公尺、往右兩公尺。 */
function threeFormations(): Flow {
	let flow = flowOf(insertFormation(flowOf(insertFormation(libSample(), 4)), 8));
	const third = flow.formations[2];
	const moved = Object.fromEntries(
		Object.entries(third.pos).map(([id, [x, y]]) => [id, [x + 2, y - 1] as [number, number]])
	);
	flow = flowOf(setPositions(flow, third.id, moved));
	return flow;
}

describe('跟第 [_] 張一樣', () => {
	it('選人後「跟第 3 張一樣」：選到的人到第 3 張的位置，沒選到的人不動', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		page.editor.playback.seek(4); // 站位 2
		await click('m1');
		await click('m3', true);

		await fireEvent.input(within(toolbar()).getByRole('spinbutton', { name: '跟第幾張站位一樣' }), {
			target: { value: '3' }
		});
		await fireEvent.click(within(toolbar()).getByRole('button', { name: '跟第 3 張一樣' }));
		const after = page.session.flow!;
		expect(after.formations[1].pos.m1).toEqual(before.formations[2].pos.m1);
		expect(after.formations[1].pos.m3).toEqual(before.formations[2].pos.m3);
		expect(after.formations[1].pos.m2).toEqual(before.formations[1].pos.m2);

		await fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
		expect(page.session.flow).toEqual(before);
	});

	it('框裡預設是播放頭前面那一張（以前的「跟上一張一樣」）；左邊欄沒有「跟上一張一樣」了', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		page.editor.playback.seek(8); // 站位 3
		await click('m1');
		expect(within(toolbar()).getByRole('button', { name: '跟第 2 張一樣' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '跟上一張一樣' })).toBeNull();
	});

	it('滑鼠停在「跟第 [_] 張一樣」任何一處（字、數字框、按鈕）都看得到一句說明（T15）', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		page.editor.playback.seek(8);
		await click('m1');
		const box = within(toolbar()).getByRole('spinbutton', { name: '跟第幾張站位一樣' });
		expect(box.closest('[title]')?.getAttribute('title')).toBe('選到的人改到那一張站位裡的位置；沒選人就是全隊');
	});

	it('打過數字後移播放頭、換選人：框回到預設（播放頭前面那一張），不留著舊數字', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		page.editor.playback.seek(4); // 站位 2
		await click('m1');
		await fireEvent.input(within(toolbar()).getByRole('spinbutton', { name: '跟第幾張站位一樣' }), {
			target: { value: '3' }
		});
		expect(within(toolbar()).getByRole('button', { name: '跟第 3 張一樣' })).toBeTruthy();

		page.editor.playback.seek(8); // 站位 3
		await tick();
		expect(within(toolbar()).getByRole('button', { name: '跟第 2 張一樣' })).toBeTruthy();

		await fireEvent.input(within(toolbar()).getByRole('spinbutton', { name: '跟第幾張站位一樣' }), {
			target: { value: '3' }
		});
		await click('m3', true);
		expect(within(toolbar()).getByRole('button', { name: '跟第 2 張一樣' })).toBeTruthy();
	});

	it('沒選人時工具列上就有「全隊跟第 [_] 張一樣」，不用右鍵也找得到（N11）', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		page.editor.playback.seek(4);
		const bar = within(toolbar());
		expect(bar.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())).toEqual([
			'全隊跟第 1 張一樣'
		]);
		await fireEvent.input(bar.getByRole('spinbutton', { name: '跟第幾張站位一樣' }), { target: { value: '3' } });
		await fireEvent.click(bar.getByRole('button', { name: '全隊跟第 3 張一樣' }));
		expect(page.session.flow!.formations[1].pos).toEqual(before.formations[2].pos);
	});

	it('沒選人時套用全隊：在場上空白處按右鍵，選單裡的「跟第 [_] 張一樣」改全部的人', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		page.editor.playback.seek(4);

		await fireEvent.contextMenu(document.querySelector('svg.field')!, { clientX: 30, clientY: 40 });
		const menu = screen.getByRole('menu', { name: '選人選單' });
		await fireEvent.input(within(menu).getByRole('spinbutton', { name: '跟第幾張站位一樣' }), {
			target: { value: '3' }
		});
		await fireEvent.click(within(menu).getByRole('menuitem', { name: '全隊跟第 3 張一樣' }));
		expect(page.session.flow!.formations[1].pos).toEqual(before.formations[2].pos);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('打超過張數：不改，提示說只有幾張、要打幾到幾，不只說「沒有站位 9」（N45）', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		page.editor.playback.seek(4);
		await click('m1');
		await fireEvent.input(within(toolbar()).getByRole('spinbutton', { name: '跟第幾張站位一樣' }), {
			target: { value: '9' }
		});
		await fireEvent.click(within(toolbar()).getByRole('button', { name: '跟第 9 張一樣' }));
		expect(page.session.flow).toBe(before);
		expect(screen.getByRole('status').textContent).toBe('只有 3 張站位，打 1–3');
	});
});

describe('站位卡片 ⌘C／⌘V', () => {
	it('⌘C 的提示寫「記下站位 N 的位置」，不用要避開的「複製站位」', async () => {
		render(Page, editorPage(threeFormations()).props);
		await fireEvent.click(thumbs()[2]);
		await fireEvent.keyDown(window, { key: 'c', metaKey: true });
		expect(screen.getByRole('status').textContent).toBe('記下站位 3 的位置；移到別的地方按 ⌘V 貼上');
	});

	it('播放頭那一拍有站位：改成複製的那張，往後帶，⌘Z 一步回去', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		await fireEvent.click(thumbs()[2]); // 選站位 3
		await fireEvent.keyDown(window, { key: 'c', metaKey: true });

		page.editor.playback.seek(0); // 開頭那張
		await fireEvent.keyDown(window, { key: 'v', metaKey: true });
		const after = page.session.flow!;
		expect(after.formations).toHaveLength(3);
		expect(after.formations[0].pos).toEqual(before.formations[2].pos);
		// 站位 2 跟開頭站一樣：往後帶
		expect(after.formations[1].pos).toEqual(before.formations[2].pos);

		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(page.session.flow).toEqual(before);
	});

	it('播放頭那一拍沒有站位：插一張，位置是複製的那張；⌘Z 一步回去', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		await fireEvent.click(thumbs()[2]);
		await fireEvent.keyDown(window, { key: 'c', ctrlKey: true });

		page.editor.playback.seek(2); // 開頭和站位 2 中間
		await fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
		const after = page.session.flow!;
		expect(after.formations).toHaveLength(4);
		expect(after.formations[1].pos).toEqual(before.formations[2].pos);
		expect(thumbs()).toHaveLength(4);
		expect(screen.getByRole('status').textContent).toMatch(/^已插入站位 \d；貼上複製的站位/);

		await fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
		expect(page.session.flow).toEqual(before);
		expect(thumbs()).toHaveLength(3);
	});

	it('複製後那些人都刪掉了：⌘V 不動流程，提示說複製的人都不在隊上，不是「先選人」', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		await fireEvent.click(thumbs()[2]);
		await fireEvent.keyDown(window, { key: 'c', metaKey: true });
		let flow = page.session.flow!;
		for (const m of flow.members) flow = flowOf(deleteMember(flow, m.id, { confirmed: true }));
		page.session.change(flow);

		page.editor.playback.seek(2);
		await fireEvent.keyDown(window, { key: 'v', metaKey: true });
		expect(page.session.flow).toBe(flow);
		expect(screen.getByRole('status').textContent).toBe('複製的人都不在隊上了，沒有貼上');
	});

	it('在拍點格子上按 ⌘V 是貼拍點，不貼站位', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		await fireEvent.click(thumbs()[2]);
		await fireEvent.keyDown(window, { key: 'c', metaKey: true });
		page.editor.playback.seek(2);
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.keyDown(grid.getByRole('button', { name: '1-1' }), { key: 'v', metaKey: true });
		expect(page.session.flow!.formations).toEqual(before.formations);
	});

	it('沒選站位卡片：⌘C、⌘V 不動流程', async () => {
		const page = editorPage(threeFormations());
		render(Page, page.props);
		const before = page.session.flow!;
		await click('m1'); // 最後點的是人
		await fireEvent.keyDown(window, { key: 'c', metaKey: true });
		page.editor.playback.seek(2);
		await fireEvent.keyDown(window, { key: 'v', metaKey: true });
		expect(page.session.flow).toBe(before);
	});
});
