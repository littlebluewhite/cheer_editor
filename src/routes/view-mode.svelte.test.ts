// 檢視模式（電腦，#174）：上方列的「編輯」開關關掉就只能看、只能播放；改流程的指令都擋下（不只藏按鈕），開回來又能改。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { editorPage } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

/** 頁面放範例流程：音樂 1、小美（m1）、小A、小B、小芳，動作 Lib（x1）。 */
function setup() {
	const { session, props } = editorPage(libSample());
	render(Page, props);
	return session;
}

const editSwitch = () => screen.getByRole('switch', { name: '編輯' }) as HTMLInputElement;
const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
const playing = () => !!screen.queryByRole('button', { name: '暫停' });
const nameBox = () => screen.getByLabelText('第 1 位隊員的名字') as HTMLInputElement;

async function drag(id: string) {
	await fireEvent.pointerDown(dot(id), { clientX: 0, clientY: 0, button: 0 });
	await fireEvent.pointerMove(dot(id), { clientX: -200, clientY: -300 });
	await fireEvent.pointerUp(dot(id), { clientX: -200, clientY: -300 });
}

describe('檢視模式', () => {
	it('預設是編輯；關掉「編輯」後拖人、Delete、⌘Z、改名都不改流程', async () => {
		const session = setup();
		expect(editSwitch().checked).toBe(true);
		// 先改一次，⌘Z 才有東西可以退
		await drag('m1');
		expect(session.canUndo).toBe(true);
		await fireEvent.click(editSwitch());
		expect(editSwitch().checked).toBe(false);
		const before = session.flow;
		const where = dot('m2').getAttribute('transform');

		await drag('m2');
		expect(session.flow).toBe(before);
		expect(dot('m2').getAttribute('transform')).toBe(where);
		expect(screen.getByRole('status').textContent).toContain('檢視模式');

		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(session.flow).toBe(before);
		expect(document.querySelector('[data-action-id="x1"]')).not.toBeNull();

		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(session.flow).toBe(before);
		// 復原、重做鈕藏起來
		expect(screen.queryByRole('button', { name: '復原' })).toBeNull();

		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await fireEvent.change(nameBox(), { target: { value: '美美' } });
		expect(session.flow).toBe(before);
		expect(nameBox().value).toBe('小美');
	});

	it('檢視模式下空白鍵照樣播放', async () => {
		setup();
		await fireEvent.click(editSwitch());
		await fireEvent.keyDown(window, { key: ' ' });
		expect(playing()).toBe(true);
	});

	it('開回「編輯」就能改', async () => {
		const session = setup();
		await fireEvent.click(editSwitch());
		await fireEvent.click(editSwitch());
		expect(editSwitch().checked).toBe(true);
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await fireEvent.change(nameBox(), { target: { value: '美美' } });
		expect(session.flow!.members[0].name).toBe('美美');
		expect(screen.getByRole('button', { name: '復原' })).toBeTruthy();
	});
});
