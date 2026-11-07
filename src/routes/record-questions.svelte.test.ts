// 頁面：會清掉紀錄的改動先問。換組、改隊員名字時選保留舊紀錄或清掉重算。
// 流程在核心裡做好（含紀錄），放一個帶著它的 session 進頁面，再讀 session 的流程看紀錄。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { squadNumber } from '#lib/core';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { editorPage, flush, recordedFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 開編輯頁、放 recordedFlow()；回傳 session。 */
function openRecorded() {
	const { session, props } = editorPage(recordedFlow());
	render(Page, props);
	return session;
}

/** session 現在的流程、Lib、小美在第幾組和紀錄是第幾組的。 */
function libOf(session: EditorSession) {
	const flow = session.flow!;
	const lib = flow.actions[0];
	const mei = squadNumber(lib, lib.members[0].squad!);
	return { flow, lib, mei, records: lib.successRate?.records.map((t) => squadNumber(lib, t.who)) };
}

const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
/** 在場上的分組浮動列把小美（m1）放進第 2 組。 */
async function moveMeiTo2() {
	await fireEvent.click(document.querySelector('[data-lane="m1"] .lab')!);
	await fireEvent.click(within(screen.getByRole('group', { name: '分組' })).getByRole('button', { name: '放進第 2 組' }));
}
const dialog = () => screen.getByRole('alertdialog');
const press = (name: string) => fireEvent.click(within(dialog()).getByRole('button', { name }));

describe('換組時問保留舊紀錄還是清掉重算', () => {
	it('把小美換到第 2 組：跳出保留舊紀錄、清掉重算、取消；按保留，紀錄都留著', async () => {
		const session = openRecorded();
		await selectLib();
		await moveMeiTo2();
		expect(dialog().textContent).toContain('有紀錄的組換了人');
		expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual([
			'保留舊紀錄',
			'清掉重算',
			'取消'
		]);

		await press('保留舊紀錄');
		expect(screen.queryByRole('alertdialog')).toBeNull();
		const { mei, records } = libOf(session);
		expect(mei).toBe(2);
		expect(records).toEqual([1, 1, 2]);
	});

	it('按清掉重算：兩組的紀錄都清掉', async () => {
		const session = openRecorded();
		await selectLib();
		await moveMeiTo2();
		await press('清掉重算');
		const { mei, records } = libOf(session);
		expect(mei).toBe(2);
		expect(records).toEqual([]);
	});

	it('按取消：組不變', async () => {
		const session = openRecorded();
		await selectLib();
		await moveMeiTo2();
		await press('取消');
		expect(document.querySelector('[data-member-id="m1"] .badge')?.textContent).toBe('1');
		const { mei, records } = libOf(session);
		expect(mei).toBe(1);
		expect(records).toEqual([1, 1, 2]);
	});
});

describe('改隊員名字時問保留還是清掉', () => {
	const nameBox = () => screen.getByLabelText('第 1 位隊員的名字') as HTMLInputElement;
	const openRoster = () => fireEvent.click(screen.getByRole('tab', { name: /隊員/ }));

	it('按保留舊紀錄：只改名字，紀錄留著', async () => {
		const session = openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		expect(dialog().textContent).toContain('小美 改名成「小芳芳」');
		await press('保留舊紀錄');
		const { flow, records } = libOf(session);
		expect(flow.members[0].name).toBe('小芳芳');
		expect(records).toEqual([1, 1, 2]);
	});

	it('按清掉重算：改名字，他在的組的紀錄清掉', async () => {
		const session = openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		await press('清掉重算');
		const { flow, records } = libOf(session);
		expect(flow.members[0].name).toBe('小芳芳');
		expect(records).toEqual([2]);
	});

	it('按取消：名字框回到原來的名字', async () => {
		openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		await press('取消');
		expect(nameBox().value).toBe('小美');
	});

	it('還沒選保留或清掉就按「新建」：先問還沒存；取消就留著，還能選保留', async () => {
		const session = openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		const unsaved = screen.getAllByRole('alertdialog').find((d) => d.textContent?.includes('還沒存'));
		expect(unsaved).toBeTruthy();
		await fireEvent.click(within(unsaved!).getByRole('button', { name: '取消' }));
		await press('保留舊紀錄');
		expect(session.flow!.members[0].name).toBe('小芳芳');
	});

	it('還沒選保留或清掉就按「新建」再按「先存檔」：不存、不新建，說先回答問題；還能選保留，改名沒不見（#208）', async () => {
		const { session, props, saves } = editorPage(recordedFlow());
		render(Page, props);
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		const unsaved = screen.getAllByRole('alertdialog').find((d) => d.textContent?.includes('還沒存'))!;
		await fireEvent.click(within(unsaved).getByRole('button', { name: '先存檔' }));
		await flush();
		expect(saves).toEqual([]);
		expect(screen.getByRole('status').textContent).toContain('先回答');
		await press('保留舊紀錄');
		expect(session.flow!.members[0].name).toBe('小芳芳');
		expect(session.unsaved).toBe(true);
	});

	it('還沒選保留或清掉就關分頁：一樣算有沒存的（#208）', async () => {
		const { editor, props } = editorPage(recordedFlow());
		render(Page, props);
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		expect(editor.hasUnsavedWork).toBe(true);
	});
});

describe('從名單刪隊員時問保留還是清掉（跟換組同一個問法）', () => {
	/** 隊員分頁按刪除第 1 位（小美，第 1 組還有小A）。 */
	async function deleteMei() {
		await fireEvent.click(screen.getByRole('tab', { name: /隊員/ }));
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
	}

	it('問保留舊紀錄、清掉重算、取消；按保留：小美刪掉，第 1 組的紀錄還在', async () => {
		const session = openRecorded();
		await deleteMei();
		expect(dialog().textContent).toContain('刪掉隊員「小美」');
		expect(dialog().textContent).toContain('有紀錄的組換了人');
		expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['保留舊紀錄', '清掉重算', '取消']);
		await press('保留舊紀錄');
		const { flow, records } = libOf(session);
		expect(flow.members.map((m) => m.name)).not.toContain('小美');
		expect(records).toEqual([1, 1, 2]);
	});

	it('按清掉重算：小美刪掉，第 1 組的紀錄沒了，第 2 組的留著', async () => {
		const session = openRecorded();
		await deleteMei();
		await press('清掉重算');
		const { flow, records } = libOf(session);
		expect(flow.members.map((m) => m.name)).not.toContain('小美');
		expect(records).toEqual([2]);
	});
});

describe('刪動作', () => {
	it('有紀錄：先確認，寫會清掉幾次；確定才刪', async () => {
		const session = openRecorded();
		await selectLib();
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(dialog().textContent).toContain('刪掉動作「技巧·Lib」會清掉 3 次紀錄');
		await press('確定');
		expect(session.flow!.actions).toEqual([]);
	});

	it('按 Delete 鍵刪：一樣先確認，取消就不刪', async () => {
		openRecorded();
		await selectLib();
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(dialog().textContent).toContain('刪掉動作「技巧·Lib」會清掉 3 次紀錄');
		await press('取消');
		expect(document.querySelector('[data-action-id="x1"]')).not.toBeNull();
	});
});
