// 八拍表「印誰」的預設（#159）：編輯畫面只選了一個人時預設印他。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { editorPage } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
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
