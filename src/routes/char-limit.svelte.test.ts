// 字數上限（#146）：輸入框旁邊看得到字數（n/20），照看得到的字算；打太多只留得下的部分，不整串丟掉。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Flow } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 打開流程，點泳道上 Lib 的色條選到它。 */
async function setup(flow: Flow = libSample()) {
	const { session, props } = editorPage(flow);
	render(Page, props);
	await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
	return session;
}

/** 欄位旁邊的字數（欄位用 aria-describedby 指到它）。 */
function count(input: HTMLElement): string | null | undefined {
	const id = input.getAttribute('aria-describedby');
	return id ? document.getElementById(id)?.textContent : null;
}

/** 在欄位裡打字（一次放進整串，像貼上）。 */
async function type(input: HTMLElement, value: string) {
	input.focus();
	await fireEvent.input(input, { target: { value } });
}

describe('字數', () => {
	it('動作名稱旁邊顯示 n/20，一個家庭 emoji 算 1 個字', async () => {
		await setup();
		const name = screen.getByLabelText('名稱');
		expect(count(name)).toBe('3/20');
		await type(name, '👨‍👩‍👧‍👦');
		expect(count(name)).toBe('1/20');
	});

	it('打到上限計數變紅（full），少一個字就不紅', async () => {
		await setup();
		const name = screen.getByLabelText('名稱');
		const counter = () => document.getElementById(name.getAttribute('aria-describedby')!)!;
		await type(name, '字'.repeat(19));
		expect(counter().classList.contains('full')).toBe(false);
		await type(name, '字'.repeat(20));
		expect(counter().classList.contains('full')).toBe(true);
	});

	it('貼上太長的動作名稱：留前 20 個字，不整串丟掉，存得進去', async () => {
		const session = await setup();
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		await type(name, '一二三四五六七八九十'.repeat(3));
		expect(name.value).toBe('一二三四五六七八九十'.repeat(2));
		expect(count(name)).toBe('20/20');
		await fireEvent.change(name);
		expect(session.flow!.actions[0].name).toBe('一二三四五六七八九十'.repeat(2));
	});

	it('輸入法選字時先不切（不然選字會壞掉），選好才只留前 20 個字', async () => {
		await setup();
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		name.focus();
		await fireEvent.compositionStart(name);
		await fireEvent.input(name, { target: { value: '字'.repeat(21) } });
		expect(name.value).toBe('字'.repeat(21));
		expect(count(name)).toBe('21/20');
		await fireEvent.compositionEnd(name);
		expect(name.value).toBe('字'.repeat(20));
		expect(count(name)).toBe('20/20');
	});

	it('20 個一樣的字前面再打一個：多的那個切掉，不會卡住', async () => {
		await setup();
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		await type(name, 'a'.repeat(20));
		name.value = 'a'.repeat(21);
		name.setSelectionRange(1, 1);
		await fireEvent.input(name);
		expect(name.value).toBe('a'.repeat(20));
	});

	it('滿 20 個 emoji 時把第一個換成兩個：留得下的那個 emoji 是完整的', async () => {
		await setup();
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		await type(name, '😀'.repeat(20));
		name.value = '😃😄' + '😀'.repeat(19);
		name.setSelectionRange(4, 4);
		await fireEvent.input(name);
		expect(name.value).toBe('😃' + '😀'.repeat(19));
	});

	it('備註旁邊顯示 n/200', async () => {
		await setup();
		const note = screen.getByLabelText('備註');
		await type(note, '注意手');
		expect(count(note)).toBe('3/200');
	});

	it('舊檔裡超過上限的名稱照收：字數照實寫，可以刪字，不會被砍掉', async () => {
		const flow = libSample();
		const long = '字'.repeat(30);
		await setup({ ...flow, actions: flow.actions.map((a) => ({ ...a, name: long })) });
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		expect(count(name)).toBe('30/20');
		await type(name, long + '多');
		expect(name.value).toBe(long);
		await type(name, '字'.repeat(29));
		expect(name.value).toBe('字'.repeat(29));
	});

	it('流程設定的流程名字旁邊顯示 n/40', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const name = screen.getByLabelText('流程名字');
		expect(count(name)).toBe('2/40');
		await type(name, '全國賽');
		expect(count(name)).toBe('3/40');
	});

	it('新建流程的名字旁邊顯示 n/40', async () => {
		render(Page, editorPage().props);
		const name = screen.getByLabelText('流程名字');
		expect(count(name)).toBe('0/40');
		await type(name, '👨‍👩‍👧‍👦'.repeat(41));
		expect(count(name)).toBe('40/40');
	});

	it('站位名稱旁邊顯示 n/20', async () => {
		await setup();
		const name = screen.getByLabelText('站位名稱');
		expect(count(name)).toBe('0/20');
		await type(name, '開場');
		expect(count(name)).toBe('2/20');
	});

	it('隊員名字：改名的那一格旁邊顯示 n/20', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		const name = screen.getByLabelText('第 1 位隊員的名字');
		await type(name, '小美美');
		expect(count(name)).toBe('3/20');
	});

	it('自訂任務角色：名稱旁邊顯示 n/8', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: '名詞對照表' }));
		const name = screen.getByLabelText('任務角色名稱');
		await type(name, '丟人的');
		expect(count(name)).toBe('3/8');
		await fireEvent.submit(name.closest('form')!);
		expect(count(screen.getByLabelText('「丟人的」的名稱'))).toBe('3/8');
	});

	it('流程名字被退回（清成空白）：字數寫欄位裡真的留下來的字（B28）', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const name = screen.getByLabelText('流程名字') as HTMLInputElement;
		await type(name, '   ');
		expect(count(name)).toBe('3/40');
		await fireEvent.change(name);
		expect(name.value).toBe('測試');
		expect(count(name)).toBe('2/40');
	});

	it('沒經過打字就變太長的備註（例如自動填入）：離開欄位時切到上限存進去，不整段退回（B20）', async () => {
		const session = await setup();
		const note = screen.getByLabelText('備註') as HTMLTextAreaElement;
		note.focus();
		note.value = '注'.repeat(207);
		await fireEvent.change(note);
		expect(note.value).toBe('注'.repeat(200));
		expect(count(note)).toBe('200/200');
		expect(session.flow!.actions[0].note).toBe('注'.repeat(200));
	});
});
