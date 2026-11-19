// 八拍表「印誰」的預設（#159）：編輯畫面只選了一個人時預設印他。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMembers } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const chosen = () =>
	(within(screen.getByRole('dialog', { name: '八拍表' })).getByLabelText('印誰') as HTMLSelectElement)
		.selectedOptions[0].textContent;

/** 點場上的隊員（不拖）。 */
async function clickDot(name: string) {
	// 場上的人名字後面接位置（「小B　第 5 條…」）
	const dot = screen.getByRole('button', { name: new RegExp(`^${name}　`), pressed: false });
	await fireEvent.pointerDown(dot, { clientX: 0, clientY: 0, button: 0 });
	await fireEvent.pointerUp(dot, { clientX: 0, clientY: 0 });
}

describe('八拍表「印誰」的預設', () => {
	beforeEach(() => localStorage.clear());

	it('場上只選小B 打開八拍表：預設印小B', async () => {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		await clickDot('小B');
		expect(session.selectedMemberIds).toEqual(['m3']);
		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		expect(chosen()).toBe('小B');
	});

	it('場上選了兩個人：照上次選的（沒選過是全隊）', async () => {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		session.selectMembers(['m2', 'm3']);
		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		expect(chosen()).toBe('全隊');
	});
});

describe('八拍表開著時復原（#210）', () => {
	beforeEach(() => localStorage.clear());

	it('印誰選的人被 ⌘Z 退掉：表回到印全隊，不是空白', async () => {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		session.change(flowOf(addMembers(session.flow!, [{ name: '阿強', gender: 'M', globalRole: 'base' }])));
		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		const dialog = screen.getByRole('dialog', { name: '八拍表' });
		const select = within(dialog).getByLabelText('印誰') as HTMLSelectElement;
		const id = session.flow!.members.find((m) => m.name === '阿強')!.id;
		await fireEvent.change(select, { target: { value: id } });
		expect(dialog.textContent).toContain('阿強');

		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(session.flow!.members.some((m) => m.name === '阿強')).toBe(false);
		expect(chosen()).toBe('全隊');
		// 全隊的表：每個隊員都在上面
		for (const m of session.flow!.members) expect(dialog.textContent).toContain(m.name);
	});
});
