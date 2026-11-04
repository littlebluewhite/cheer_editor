// 頁面：在拍點格子選幾拍標成環節；成功率區的環節清單寫出拍和裡面的拍點，格子裡多一列環節；
// 把動作改短切到環節時先問。流程在核心裡做好再開檔（同 phases.svelte.test.ts）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	enableSuccessRate,
	placeCue,
	readFlowFile,
	setSquad,
	updateSegment,
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

/** 等 async 的開檔跑完。 */
const settle = () => new Promise((r) => setTimeout(r, 0));

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

/** 音樂 1；Lib（技巧，1-1 起兩個八拍）記成功率（上法、中段、下法），步驟「上」1-3 到 1-5；小美、小A 第 1 組。 */
function libFlow(): Flow {
	let flow = flowOf(enableSuccessRate(plainFlow(), 'x1'));
	flow = flowOf(setSquad(flow, 'x1', 'm1', 1));
	return flowOf(setSquad(flow, 'x1', 'm2', 1));
}

/** 跟 libFlow 一樣，但 Lib 還沒記成功率、沒分組。 */
function plainFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 32, note: '', members }));
	return flowOf(placeCue(flow, 'x1', { kind: 'step', at: 4, len: 6, word: '上' }));
}

/** 開檔、點泳道上 Lib 的色條選到它；回傳存過的檔。 */
async function open(flow = libFlow()) {
	const saves = setup();
	await openFile(writeFlowFile(flow, {}), '開啟流程檔');
	return saves;
}

async function openFile(bytes: Uint8Array, label: string) {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], '練習用.zip');
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await settle();
	await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
}

const grid = () => within(screen.getByRole('group', { name: '拍點' }));
const rate = () => within(screen.getByRole('group', { name: '成功率' }));
/** 環節清單每一列的名字（種類加名字）。 */
const rows = () =>
	within(screen.getByRole('list', { name: '環節' }))
		.getAllByRole('listitem')
		.map((li) => li.getAttribute('aria-label'));
/** 清單裡某一列的拍和拍點。 */
const span = (label: string) => screen.getByRole('listitem', { name: label }).querySelector('.span')?.textContent?.trim();
/** 格子裡環節那一列的環節（每個環節一個；跨八拍的後半段不算）。 */
const gridPhases = () => grid().queryAllByRole('button', { name: /^環節 / }).map((b) => b.getAttribute('aria-label'));
/** 拍點小窗裡的「環節」那一列。 */
const popPhase = () => within(within(screen.getByRole('dialog', { name: '拍點小窗' })).getByRole('group', { name: '環節' }));

/** 點 from 那一格，再按住 Shift 點 to：選好一段，跳出拍點小窗。 */
async function select(from: string, to: string) {
	await fireEvent.click(grid().getByRole('button', { name: from }));
	await fireEvent.click(grid().getByRole('button', { name: to }), { shiftKey: true });
}

/** 在小窗的環節列給種類和名字，按加入。 */
async function addNew(kind: string, name: string) {
	await fireEvent.change(popPhase().getByRole('combobox', { name: '環節的種類' }), { target: { value: kind } });
	await fireEvent.input(popPhase().getByRole('textbox', { name: '環節的名字' }), { target: { value: name } });
	await fireEvent.click(popPhase().getByRole('button', { name: '加入環節' }));
}

/** 例子：1-1 到 1-3 加上法「延伸」，1-4 到 2-3 標給中段，2-5 到 2-8 加下法「搖籃」。 */
async function example() {
	await open();
	await select('1-1', '1-3');
	await addNew('load', '延伸');
	await select('1-4', '2-3');
	await fireEvent.click(popPhase().getByRole('button', { name: '把這幾拍標給 中段' }));
	await select('2-5', '2-8');
	await addNew('dismount', '搖籃');
}

describe('拍點格子上標環節', () => {
	it('選拍加新環節、標給現有的：清單寫出拍和裡面的拍點，格子裡多一列環節', async () => {
		await example();
		expect(rows()).toEqual(['上法 延伸', '中段', '下法 搖籃', '上法', '下法']);
		expect(span('上法 延伸')).toBe('1-1 到 1-3上');
		expect(span('中段')).toBe('1-4 到 2-3上');
		expect(span('下法 搖籃')).toBe('2-5 到 2-8');
		expect(span('上法')).toBe('沒標拍');
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3', '環節 中段 1-4 到 2-3', '環節 下法 搖籃 2-5 到 2-8']);
	});

	it('點清單的一個環節，它那幾拍就亮起來；再點一次就不亮', async () => {
		await example();
		const button = within(screen.getByRole('listitem', { name: '中段' })).getByRole('button', { name: /^1-4 到 2-3/ });
		await fireEvent.click(button);
		expect(button.getAttribute('aria-pressed')).toBe('true');
		const lit = [...document.querySelectorAll('.zone.lit')].map((z) => (z as HTMLElement).dataset.phase);
		expect(lit).toEqual(['p2', 'p2']);
		await fireEvent.click(button);
		expect(document.querySelectorAll('.zone.lit')).toHaveLength(0);
	});

	it('清掉：拿掉選的拍裡的環節，環節還在清單上', async () => {
		await example();
		await select('2-1', '2-8');
		await fireEvent.click(popPhase().getByRole('button', { name: '清掉環節' }));
		expect(rows()).toEqual(['上法 延伸', '中段', '下法 搖籃', '上法', '下法']);
		expect(span('中段')).toBe('1-4 到 1-8上');
		expect(span('下法 搖籃')).toBe('沒標拍');
	});


	it('在表單把動作改短、切到環節：先問；取消就還原，確定才變沒標拍', async () => {
		await example();
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		await fireEvent.input(length, { target: { value: '12' } });
		await fireEvent.change(length);
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('動作「技巧·Lib」變短，會讓 1 個環節變沒標拍')).toBeTruthy();
		expect(dialog.getByText('變沒標拍：環節 下法 搖籃 2-5 到 2-8')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(length.value).toBe('16');
		expect(span('下法 搖籃')).toBe('2-5 到 2-8');

		await fireEvent.input(length, { target: { value: '12' } });
		await fireEvent.change(length);
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定' }));
		expect(length.value).toBe('12');
		expect(span('下法 搖籃')).toBe('沒標拍');
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3', '環節 中段 1-4 到 2-3']);
	});
});

describe('沒記成功率的動作也能加環節', () => {
	const rated = () => (rate().getByRole('checkbox', { name: '記成功率' }) as HTMLInputElement).checked;
	const squad = (who: string) => (screen.getByRole('combobox', { name: `${who} 的組` }) as HTMLSelectElement).value;

	it('格子有環節那一列；選拍加入就開始記成功率，只有這個環節，全部的人第 1 組；存檔再開還在', async () => {
		const saves = await open(plainFlow());
		expect(rated()).toBe(false);
		expect(grid().getAllByText('環節')).toHaveLength(2);

		await select('1-1', '1-3');
		await addNew('load', '延伸');
		expect(rated()).toBe(true);
		expect(rows()).toEqual(['上法 延伸']);
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3']);
		expect([squad('小美'), squad('小A')]).toEqual(['1', '1']);

		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await settle();
		const r = readFlowFile(saves[0]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.actions[0].successRate?.phases).toEqual([
			{ id: 'p1', kind: 'load', name: '延伸', beats: { at: 0, len: 6 } }
		]);
		expect(r.flow.actions[0].members.map((m) => m.squad)).toEqual([1, 1]);

		await openFile(saves[0], '開啟');
		expect(rows()).toEqual(['上法 延伸']);
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3']);
	});

	it('可以復原、重做', async () => {
		await open(plainFlow());
		await select('1-1', '1-3');
		await addNew('load', '延伸');
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(rated()).toBe(false);
		expect(gridPhases()).toEqual([]);
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		expect(rated()).toBe(true);
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3']);
	});
});
