// 頁面：會清掉紀錄的改動先問。換組、改隊員名字時選保留舊紀錄或清掉重算。
// 流程在核心裡做好（含紀錄），放一個帶著它的 session 進頁面，再讀 session 的流程看紀錄。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	markPhaseBeats,
	recordAttempt,
	setSquad,
	type CommandResult,
	type Flow
} from '#lib/core';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { editorPage } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

/** Lib（技巧）的環節上法 1-1 到 1-2、中段 1-3 到 1-6、下法 1-7 到 1-8：小美、小A 第 1 組（記了 2 次），小芳、小B 第 2 組（記了 1 次）。 */
function recordedFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '上層' },
		{ memberId: 'm4', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 4, 8], ['dismount', 12, 4]] as const) {
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind, name: '' }, at, len));
	}
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', [id], squad));
	}
	for (const who of [1, 1, 2]) {
		const attempt = { date: '2026-11-04', who, practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } };
		flow = flowOf(recordAttempt(flow, 'x1', attempt));
	}
	return flow;
}

/** 開編輯頁、放 recordedFlow()；回傳 session。 */
function openRecorded() {
	const { session, props } = editorPage(recordedFlow());
	render(Page, props);
	return session;
}

/** session 現在的流程、Lib 和紀錄是哪一組的。 */
function libOf(session: EditorSession) {
	const flow = session.flow!;
	return { flow, lib: flow.actions[0], records: flow.actions[0].successRate?.records.map((t) => t.who) };
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
		const { lib, records } = libOf(session);
		expect(lib.members[0].squad).toBe(2);
		expect(records).toEqual([1, 1, 2]);
	});

	it('按清掉重算：兩組的紀錄都清掉', async () => {
		const session = openRecorded();
		await selectLib();
		await moveMeiTo2();
		await press('清掉重算');
		const { lib, records } = libOf(session);
		expect(lib.members[0].squad).toBe(2);
		expect(records).toEqual([]);
	});

	it('按取消：組不變', async () => {
		const session = openRecorded();
		await selectLib();
		await moveMeiTo2();
		await press('取消');
		expect(document.querySelector('[data-member-id="m1"] .badge')?.textContent).toBe('1');
		const { lib, records } = libOf(session);
		expect(lib.members[0].squad).toBe(1);
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
