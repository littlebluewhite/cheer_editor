// 頁面：會清掉紀錄的改動先問。換組、改隊員名字時選保留舊紀錄或清掉重算；關掉記成功率要確認。
// 流程在核心裡做好（含紀錄）再開檔，存檔後讀回來看紀錄（同 success-rate.svelte.test.ts）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	markPhaseBeats,
	readFlowFile,
	recordAttempt,
	setSquad,
	writeFlowFile,
	type CommandResult,
	type Flow
} from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { FileSaver } from '#lib/file/save.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

function setup() {
	const saves: Uint8Array[] = [];
	const saver: FileSaver = {
		async save(bytes) {
			saves.push(bytes);
			return 'saved';
		}
	};
	render(Page, {
		createEngine: () => createFakeEngine(),
		createSaver: () => saver,
		decode: async () => ({ durationSec: 30, peaks: [] })
	});
	return saves;
}

/** 等 async 的存檔／開檔跑完。 */
const settle = () => new Promise((r) => setTimeout(r, 0));

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
		flow = flowOf(setSquad(flow, 'x1', id, squad));
	}
	for (const who of [1, 1, 2]) {
		const attempt = { date: '2026-11-04', who, practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } };
		flow = flowOf(recordAttempt(flow, 'x1', attempt));
	}
	return flow;
}

async function openRecorded() {
	const saves = setup();
	const file = new File([writeFlowFile(recordedFlow(), {}) as Uint8Array<ArrayBuffer>], '練習用.zip');
	await fireEvent.change(screen.getByLabelText('開啟流程檔'), { target: { files: [file] } });
	await settle();
	return saves;
}

/** 存檔，讀回來的 Lib。 */
async function savedLib(saves: Uint8Array[]) {
	await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
	await settle();
	const r = readFlowFile(saves.at(-1)!);
	if (r.kind !== 'ok') throw new Error(r.message);
	return { flow: r.flow, lib: r.flow.actions[0], records: r.flow.actions[0].successRate?.records.map((t) => t.who) };
}

const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
const squadOf = (who: string) => screen.getByRole('combobox', { name: `${who} 的組` }) as HTMLSelectElement;
const dialog = () => screen.getByRole('alertdialog');
const press = (name: string) => fireEvent.click(within(dialog()).getByRole('button', { name }));

describe('換組時問保留舊紀錄還是清掉重算', () => {
	it('把小美換到第 2 組：跳出保留舊紀錄、清掉重算、取消；按保留，紀錄都留著', async () => {
		const saves = await openRecorded();
		await selectLib();
		await fireEvent.change(squadOf('小美'), { target: { value: '2' } });
		expect(dialog().textContent).toContain('有紀錄的組換了人');
		expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual([
			'保留舊紀錄',
			'清掉重算',
			'取消'
		]);

		await press('保留舊紀錄');
		expect(screen.queryByRole('alertdialog')).toBeNull();
		const { lib, records } = await savedLib(saves);
		expect(lib.members[0].squad).toBe(2);
		expect(records).toEqual([1, 1, 2]);
	});

	it('按清掉重算：兩組的紀錄都清掉', async () => {
		const saves = await openRecorded();
		await selectLib();
		await fireEvent.change(squadOf('小美'), { target: { value: '2' } });
		await press('清掉重算');
		const { lib, records } = await savedLib(saves);
		expect(lib.members[0].squad).toBe(2);
		expect(records).toEqual([]);
	});

	it('按取消：組不變，選單回到原來的組', async () => {
		const saves = await openRecorded();
		await selectLib();
		await fireEvent.change(squadOf('小美'), { target: { value: '2' } });
		await press('取消');
		expect(squadOf('小美').value).toBe('1');
		const { lib, records } = await savedLib(saves);
		expect(lib.members[0].squad).toBe(1);
		expect(records).toEqual([1, 1, 2]);
	});
});

describe('改隊員名字時問保留還是清掉', () => {
	const nameBox = () => screen.getByLabelText('第 1 位隊員的名字') as HTMLInputElement;
	const openRoster = () => fireEvent.click(screen.getByRole('tab', { name: /隊員/ }));

	it('按保留舊紀錄：只改名字，紀錄留著', async () => {
		const saves = await openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		expect(dialog().textContent).toContain('小美 改名成「小芳芳」');
		await press('保留舊紀錄');
		const { flow, records } = await savedLib(saves);
		expect(flow.members[0].name).toBe('小芳芳');
		expect(records).toEqual([1, 1, 2]);
	});

	it('按清掉重算：改名字，他在的組的紀錄清掉', async () => {
		const saves = await openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		await press('清掉重算');
		const { flow, records } = await savedLib(saves);
		expect(flow.members[0].name).toBe('小芳芳');
		expect(records).toEqual([2]);
	});

	it('按取消：名字框回到原來的名字', async () => {
		await openRecorded();
		await openRoster();
		await fireEvent.change(nameBox(), { target: { value: '小芳芳' } });
		await press('取消');
		expect(nameBox().value).toBe('小美');
	});
});

describe('關掉記成功率', () => {
	it('有紀錄：先看到確認，寫會清掉幾次；取消還開著，確定才關', async () => {
		const saves = await openRecorded();
		await selectLib();
		const toggle = () => screen.getByRole('checkbox', { name: '記成功率' }) as HTMLInputElement;
		await fireEvent.click(toggle());
		expect(dialog().textContent).toContain('關掉記成功率會清掉動作「技巧·Lib」的 3 次紀錄');
		await press('取消');
		expect(toggle().checked).toBe(true);

		await fireEvent.click(toggle());
		await press('確定');
		expect(toggle().checked).toBe(false);
		const { lib } = await savedLib(saves);
		expect(lib.successRate).toBeUndefined();
	});

});

describe('刪動作', () => {
	it('有紀錄：先確認，寫會清掉幾次；確定才刪', async () => {
		const saves = await openRecorded();
		await selectLib();
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(dialog().textContent).toContain('刪掉動作「技巧·Lib」會清掉 3 次紀錄');
		await press('確定');
		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await settle();
		const r = readFlowFile(saves.at(-1)!);
		expect(r.kind === 'ok' && r.flow.actions).toEqual([]);
	});

	it('按 Delete 鍵刪：一樣先確認，取消就不刪', async () => {
		await openRecorded();
		await selectLib();
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(dialog().textContent).toContain('刪掉動作「技巧·Lib」會清掉 3 次紀錄');
		await press('取消');
		expect(document.querySelector('[data-action-id="x1"]')).not.toBeNull();
	});
});
