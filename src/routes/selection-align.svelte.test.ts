// 選人工具列的對齊、平均分開（#223）：選 2 人以上有「對齊 ▾」（橫排、直排），3 人以上有「平均分開」；
// 跟鏡像一樣走拖人那條路，做完 ⌘Z 一步回去。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { alignColumn, alignRow, insertFormation, spreadEvenly } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（點場上的人，泳道會捲過去）。
Element.prototype.scrollIntoView = () => {};

const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
const toolbar = () => within(screen.getByRole('toolbar', { name: '選人工具列' }));
const has = (name: string) => toolbar().queryByRole('button', { name }) !== null;

async function select(...ids: string[]) {
	for (const [i, id] of ids.entries()) {
		await fireEvent.pointerDown(dot(id), {
			clientX: 0,
			clientY: 0,
			button: 0,
			shiftKey: i > 0
		});
		await fireEvent.pointerUp(dot(id), {
			clientX: 0,
			clientY: 0,
			shiftKey: i > 0
		});
	}
}

describe('對齊、平均分開', () => {
	it('選 1 人沒有對齊、平均分開；選 2 人多了對齊；選 3 人再多平均分開', async () => {
		render(Page, editorPage(libSample()).props);
		await select('m1');
		expect([has('鏡像'), has('對齊 ▾'), has('平均分開')]).toEqual([true, false, false]);
		await select('m1', 'm2');
		expect([has('鏡像'), has('對齊 ▾'), has('平均分開')]).toEqual([true, true, false]);
		await select('m1', 'm2', 'm3');
		expect([has('鏡像'), has('對齊 ▾'), has('平均分開')]).toEqual([true, true, true]);
	});

	it('對齊 ▾ 選「排成一橫排」：在沒有站位的那一拍插一張、往後帶，⌘Z 一步回去', async () => {
		const page = editorPage(flowOf(insertFormation(libSample(), 8)));
		render(Page, page.props);
		const before = page.session.flow!;
		page.editor.playback.seek(4);
		await select('m1', 'm2', 'm3');

		await fireEvent.click(toolbar().getByRole('button', { name: '對齊 ▾' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: '排成一橫排' }));
		const after = page.session.flow!;
		const pos0 = before.formations[0].pos;
		const want = alignRow(before.field, { m1: pos0.m1, m2: pos0.m2, m3: pos0.m3 }, 1);
		expect(after.formations).toHaveLength(3);
		for (const id of ['m1', 'm2', 'm3']) {
			expect(after.formations[1].pos[id]).toEqual(want[id]);
			expect(after.formations[2].pos[id]).toEqual(want[id]);
		}
		expect(after.formations[1].pos.m4).toEqual(pos0.m4);
		expect(screen.queryByRole('menu')).toBeNull();

		await fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
		expect(page.session.flow).toEqual(before);
	});

	it('對齊 ▾ 選「排成一直排」：左右取平均，⌘Z 一步回去', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		const before = page.session.flow!;
		await select('m1', 'm4');
		await fireEvent.click(toolbar().getByRole('button', { name: '對齊 ▾' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: '排成一直排' }));
		const pos0 = before.formations[0].pos;
		const want = alignColumn(before.field, { m1: pos0.m1, m4: pos0.m4 }, 1);
		expect(page.session.flow!.formations[0].pos.m1).toEqual(want.m1);
		expect(page.session.flow!.formations[0].pos.m4).toEqual(want.m4);

		await fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
		expect(page.session.flow).toEqual(before);
	});

	it('平均分開：兩端不動、中間的人排到中間，⌘Z 一步回去', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		const before = page.session.flow!;
		await select('m1', 'm2', 'm3', 'm4');
		await fireEvent.click(toolbar().getByRole('button', { name: '平均分開' }));
		const pos0 = before.formations[0].pos;
		const want = spreadEvenly(before.field, { m1: pos0.m1, m2: pos0.m2, m3: pos0.m3, m4: pos0.m4 }, 1);
		expect(page.session.flow).not.toEqual(before);
		for (const id of ['m1', 'm2', 'm3', 'm4']) expect(page.session.flow!.formations[0].pos[id]).toEqual(want[id]);

		await fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
		expect(page.session.flow).toEqual(before);
	});

	it('右鍵選單一樣有「對齊 ▾」，點開是橫排、直排兩項', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		await select('m1', 'm4');
		await fireEvent.contextMenu(dot('m4'), { clientX: 30, clientY: 40 });
		const menu = within(screen.getByRole('menu', { name: '選人選單' }));
		expect(menu.queryByRole('menuitem', { name: '排成一橫排' })).toBeNull();
		await fireEvent.click(menu.getByRole('menuitem', { name: '對齊 ▾' }));
		await fireEvent.click(menu.getByRole('menuitem', { name: '排成一橫排' }));
		const pos0 = libSample().formations[0].pos;
		expect(page.session.flow!.formations[0].pos.m1).toEqual(
			alignRow(page.session.flow!.field, { m1: pos0.m1, m4: pos0.m4 }, 1).m1
		);
		expect(screen.queryByRole('menu')).toBeNull();
	});
});
