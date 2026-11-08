// 選人工具列和右鍵選單（#222）：選到人才出現，兩邊是同一份「現在可以做的事」；鏡像跟拖人走同一條路。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { insertFormation } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（點場上的人，泳道會捲過去）。
Element.prototype.scrollIntoView = () => {};

const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
const toolbar = () => screen.queryByRole('toolbar', { name: '選人工具列' });
const thumbs = () => screen.queryAllByRole('button', { name: /^站位 \d+$/ });
const labels = (els: HTMLElement[]) => els.map((el) => el.textContent?.trim());

async function click(id: string, shiftKey = false) {
	await fireEvent.pointerDown(dot(id), { clientX: 0, clientY: 0, button: 0, shiftKey });
	await fireEvent.pointerUp(dot(id), { clientX: 0, clientY: 0, shiftKey });
}

describe('選人工具列', () => {
	it('選到人才有鏡像等項目，沒選人只剩「全隊跟第 [_] 張一樣」', async () => {
		render(Page, editorPage(libSample()).props);
		expect(within(toolbar()!).queryByRole('button', { name: '鏡像' })).toBeNull();
		await click('m1');
		expect(within(toolbar()!).getByRole('button', { name: '鏡像' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '不選人' }));
		expect(within(toolbar()!).queryByRole('button', { name: '鏡像' })).toBeNull();
		expect(within(toolbar()!).getByRole('button', { name: /^全隊跟第 \d+ 張一樣$/ })).toBeTruthy();
	});

	it('在選到的人身上按右鍵：出現跟工具列一樣的選單；在沒選到的人身上按，選取換成他', async () => {
		render(Page, editorPage(libSample()).props);
		await click('m1');
		await click('m2', true);
		await fireEvent.contextMenu(dot('m2'), { clientX: 30, clientY: 40 });
		const menu = screen.getByRole('menu', { name: '選人選單' });
		expect(labels(within(menu).getAllByRole('menuitem'))).toEqual(labels(within(toolbar()!).getAllByRole('button')));
		// 在選到的人身上按：選取不變
		expect(['m1', 'm2'].map((id) => dot(id).getAttribute('aria-pressed'))).toEqual(['true', 'true']);

		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		await fireEvent.contextMenu(dot('m4'), { clientX: 30, clientY: 40 });
		expect(screen.getByRole('menu', { name: '選人選單' })).toBeTruthy();
		expect(dot('m4').getAttribute('aria-pressed')).toBe('true');
		expect(dot('m1').getAttribute('aria-pressed')).toBe('false');
	});

	it('在沒有站位的那一拍鏡像：插一張站位、往後帶、⌘Z 一步回去', async () => {
		// 開頭那張和 8 秒那張大家站一樣的位置；播放頭停在 4 秒（中間沒有站位）。
		const page = editorPage(flowOf(insertFormation(libSample(), 8)));
		render(Page, page.props);
		const before = page.session.flow!;
		const [x, y] = before.formations[0].pos.m3; // 小B 站在中線左邊一格
		expect(x).toBeLessThan(0);
		page.editor.playback.seek(4);
		await click('m3');

		await fireEvent.click(within(toolbar()!).getByRole('button', { name: '鏡像' }));
		const after = page.session.flow!;
		expect(after.formations).toHaveLength(3);
		expect(after.formations[1].pos.m3[0]).toBeCloseTo(-x, 9);
		expect(after.formations[1].pos.m3[1]).toBe(y);
		expect(after.formations[2].pos.m3).toEqual(after.formations[1].pos.m3);
		expect(after.formations[1].pos.m4).toEqual(before.formations[0].pos.m4);
		expect(thumbs()).toHaveLength(3);
		expect(screen.getByRole('status').textContent).toBe('插了一張站位，大家的位置自動帶入；往後帶了 1 張');

		await fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
		expect(page.session.flow).toEqual(before);
		expect(thumbs()).toHaveLength(2);
	});

	it('右鍵選單的鏡像跟工具列做一樣的事，做完選單收起來', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		const [x] = page.session.flow!.formations[0].pos.m3;
		await fireEvent.contextMenu(dot('m3'), { clientX: 30, clientY: 40 });
		await fireEvent.click(screen.getByRole('menuitem', { name: '鏡像' }));
		expect(page.session.flow!.formations[0].pos.m3[0]).toBeCloseTo(-x, 9);
		expect(screen.queryByRole('menu')).toBeNull();
	});
});
