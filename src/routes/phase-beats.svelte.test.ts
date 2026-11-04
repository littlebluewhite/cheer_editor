// 頁面：在拍點格子選幾拍標成環節，格子裡多一列環節；拍清光的環節自動刪掉（有記號先問），
// 刪掉最後一個就不記成功率；把動作改短切到環節時先問。口號段的動作直接一列環節，不用標拍。
// 流程在核心裡做好，放一個帶著它的 session 進頁面，再讀 session 的流程。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addPhase,
	addSegment,
	createFlow,
	placeCue,
	readFlowFile,
	recordAttempt,
	updateSegment,
	type Flow
} from '#lib/core';
import { flowOf, squadNumbers } from '#lib/core/test-flows.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { editorPage, openFile, settle } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/**
 * 音樂 1；Lib（技巧，1-1 起兩個八拍）的環節：1-1 到 1-3 上法「延伸」（p1）、1-4 到 2-3 中段（p2）、
 * 2-5 到 2-8 下法「搖籃」（p3）；步驟「上」1-3 到 1-5；小美、小A 第 1 組。
 */
function libFlow(): Flow {
	let flow = flowOf(addPhase(plainFlow(), 'x1', { kind: 'load', name: '延伸', beats: { at: 0, len: 6 } }));
	flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 6, len: 16 } }));
	return flowOf(addPhase(flow, 'x1', { kind: 'dismount', name: '搖籃', beats: { at: 24, len: 8 } }));
}

/** 跟 libFlow 一樣，但 Lib 還沒有環節（不記成功率、沒分組）。 */
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

/** 開編輯頁放 flow、點泳道上 Lib 的色條選到它；回傳 session 和存下來的檔。 */
async function open(flow = libFlow()) {
	const page = editorPage(flow);
	render(Page, page.props);
	await selectLib();
	return page;
}

const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);

const grid = () => within(screen.getByRole('group', { name: '拍點' }));
/** 格子裡環節那一列的環節（每個環節一個；跨八拍的後半段不算）。 */
const gridPhases = () => grid().queryAllByRole('button', { name: /^環節 / }).map((b) => b.getAttribute('aria-label'));
/** 拍點小窗裡的「環節」那一列。 */
const popPhase = () => within(within(screen.getByRole('dialog', { name: '拍點小窗' })).getByRole('group', { name: '環節' }));
/** 人員清單上某個人的組標籤寫的號碼（沒有標籤是 null，沒分組是 ''）。 */
const squad = (who: string) => {
	const tag = [...document.querySelectorAll('.action-form .people li')]
		.find((li) => li.querySelector('.name')?.textContent === who)
		?.querySelector('.squad-tag')?.textContent;
	return tag === undefined ? null : (tag.match(/\d+/)?.[0] ?? '');
};
/** 三個環節都在。 */
const ALL = ['環節 上法 延伸 1-1 到 1-3', '環節 中段 1-4 到 2-3', '環節 下法 搖籃 2-5 到 2-8'];

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

describe('拍點格子上標環節', () => {
	it('選拍加新環節、標給現有的：格子裡多一列環節，照拍的先後排', async () => {
		await open(plainFlow());
		await select('2-5', '2-8');
		await addNew('dismount', '搖籃');
		await select('1-1', '1-3');
		await addNew('load', '延伸');
		await select('1-1', '1-5');
		await fireEvent.click(popPhase().getByRole('button', { name: '把這幾拍標給 上法 延伸' }));
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-5', '環節 下法 搖籃 2-5 到 2-8']);
	});

	it('在格子上按住拖過幾拍選好，再加環節', async () => {
		await open(plainFlow());
		// 換掉的座標換算（editorPage 給的）：clientX 是第幾格，1-1 是 0。
		const cell = grid().getByRole('button', { name: '2-5' });
		await fireEvent.pointerDown(cell, { clientX: 12, clientY: 0, button: 0, pointerId: 1 });
		await fireEvent.pointerMove(cell, { clientX: 15, clientY: 0, pointerId: 1 });
		await fireEvent.pointerUp(cell, { clientX: 15, clientY: 0, pointerId: 1 });
		await addNew('dismount', '搖籃');
		expect(gridPhases()).toEqual(['環節 下法 搖籃 2-5 到 2-8']);
	});

	it('清掉：只清到一部分的變短；拍清光的環節不見了', async () => {
		await open();
		await select('2-1', '2-8');
		await fireEvent.click(popPhase().getByRole('button', { name: '清掉環節' }));
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3', '環節 中段 1-4 到 1-8']);
		expect(popPhase().queryByRole('button', { name: '把這幾拍標給 下法 搖籃' })).toBeNull();
	});

	it('把一個環節的拍全部標給別的環節：原來那個不見了', async () => {
		await open();
		await select('1-1', '2-3');
		await fireEvent.click(popPhase().getByRole('button', { name: '把這幾拍標給 上法 延伸' }));
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 2-3', '環節 下法 搖籃 2-5 到 2-8']);
	});

	it('要刪的環節有記號：先問會清掉幾次的記號；取消什麼都不變，確定才刪', async () => {
		const marks = { date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks: { p3: '✗' } } as const;
		await open(flowOf(recordAttempt(libFlow(), 'x1', marks)));
		await select('2-5', '2-8');
		await fireEvent.click(popPhase().getByRole('button', { name: '清掉環節' }));
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('會刪掉 1 個環節，清掉 1 次的記號，確定就刪掉')).toBeTruthy();
		expect(dialog.getByText('刪掉：環節 下法 搖籃')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(gridPhases()).toEqual(ALL);

		await fireEvent.click(popPhase().getByRole('button', { name: '清掉環節' }));
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定刪除' }));
		expect(gridPhases()).toEqual(ALL.slice(0, 2));
	});

	it('刪掉最後一個環節：動作不記成功率了，人員清單的組標籤也不見', async () => {
		const { session } = await open();
		expect(squad('小美')).toBe('1');
		await select('1-1', '2-8');
		await fireEvent.click(popPhase().getByRole('button', { name: '清掉環節' }));
		expect(gridPhases()).toEqual([]);
		expect(squad('小美')).toBeNull();
		expect(session.flow!.actions[0].successRate).toBeUndefined();
	});

	it('在表單把動作改短、切到環節：先問；取消就還原，確定才刪掉', async () => {
		await open();
		const length = screen.getByLabelText('長度') as HTMLInputElement;
		await fireEvent.input(length, { target: { value: '12' } });
		await fireEvent.change(length);
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('動作「技巧·Lib」變短，會刪掉 1 個環節')).toBeTruthy();
		expect(dialog.getByText('刪掉：環節 下法 搖籃 2-5 到 2-8')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(length.value).toBe('16');
		expect(gridPhases()).toEqual(ALL);

		await fireEvent.input(length, { target: { value: '12' } });
		await fireEvent.change(length);
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定' }));
		expect(length.value).toBe('12');
		expect(gridPhases()).toEqual(ALL.slice(0, 2));
	});
});

describe('點環節的色條改它', () => {
	/** 泳道上小美那條 Lib 的環節細條。 */
	const lanePhases = () =>
		[...document.querySelectorAll<HTMLElement>('[data-lane="m1"] [data-phase]')].map((el) => el.dataset.phase);

	it('改名字、種類：拍點格子和泳道都跟著變；可以復原、重做', async () => {
		await open();
		await fireEvent.click(grid().getByRole('button', { name: '環節 中段 1-4 到 2-3' }));
		await fireEvent.change(popPhase().getByRole('combobox', { name: '這個環節的種類' }), { target: { value: 'dismount' } });
		await fireEvent.change(popPhase().getByRole('textbox', { name: '這個環節的名字' }), { target: { value: '轉身' } });
		const renamed = ['環節 上法 延伸 1-1 到 1-3', '環節 下法 轉身 1-4 到 2-3', '環節 下法 搖籃 2-5 到 2-8'];
		expect(gridPhases()).toEqual(renamed);
		expect(lanePhases()).toEqual(['上法 延伸', '下法 轉身', '下法 搖籃']);
		expect(popPhase().getByRole('button', { name: '把這幾拍標給 下法 轉身' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(gridPhases()).toEqual([ALL[0], '環節 下法 1-4 到 2-3', ALL[2]]);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(gridPhases()).toEqual(ALL);
		expect(lanePhases()).toEqual(['上法 延伸', '中段', '下法 搖籃']);
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		expect(gridPhases()).toEqual(renamed);
	});

	it('改顏色：格子和泳道換成那個顏色', async () => {
		await open();
		await fireEvent.click(grid().getByRole('button', { name: '環節 上法 延伸 1-1 到 1-3' }));
		await fireEvent.change(popPhase().getByRole('combobox', { name: '這個環節的顏色' }), { target: { value: '#475569' } });
		const bar = grid().getByRole('button', { name: '環節 上法 延伸 1-1 到 1-3' });
		expect(bar.style.getPropertyValue('--c')).toBe('#475569');
		const lane = document.querySelector<HTMLElement>('[data-lane="m1"] [data-phase="上法 延伸"]')!;
		expect(lane.style.background).toBe('rgb(71, 85, 105)');
	});
});

describe('沒記成功率的動作也能加環節', () => {
	it('格子有環節那一列；選拍加入就開始記成功率，只有這個環節，全部的人第 1 組；存檔再開還在', async () => {
		const { saves } = await open(plainFlow());
		expect(squad('小美')).toBeNull();
		expect(grid().getAllByText('環節')).toHaveLength(2);

		await select('1-1', '1-3');
		await addNew('load', '延伸');
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3']);
		expect([squad('小美'), squad('小A')]).toEqual(['1', '1']);

		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await settle();
		const r = readFlowFile(saves[0]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(r.flow.actions[0].successRate?.phases).toEqual([
			{ id: 'p1', kind: 'load', name: '延伸', beats: { at: 0, len: 6 } }
		]);
		expect(squadNumbers(r.flow.actions[0])).toEqual([1, 1]);

		await openFile(saves[0], '開啟');
		await selectLib();
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3']);
	});

	it('可以復原、重做', async () => {
		await open(plainFlow());
		await select('1-1', '1-3');
		await addNew('load', '延伸');
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(squad('小美')).toBeNull();
		expect(gridPhases()).toEqual([]);
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		expect(squad('小美')).toBe('1');
		expect(gridPhases()).toEqual(['環節 上法 延伸 1-1 到 1-3']);
	});
});

describe('口號段的環節（不用標拍）', () => {
	/** plainFlow 加口號段 s2，裡面 Toss（拋投，小美、小A，0 到 3 秒），還沒有環節。 */
	function chantFlow(): Flow {
		const flow = flowOf(addSegment(plainFlow(), 'chant'));
		const members = [
			{ memberId: 'm1', role: '上層' },
			{ memberId: 'm2', role: '主底' }
		];
		return flowOf(addAction(flow, { segmentId: 's2', category: 'toss', name: 'Toss', start: 0, length: 30, note: '', members }));
	}

	/** 開編輯頁放 flow、點泳道上 Toss 的色條；回傳 session。 */
	async function openChant(flow = chantFlow()) {
		const { session, props } = editorPage(flow);
		render(Page, props);
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x2"]')!);
		return session;
	}

	/** 拍點那一區的「環節」列（口號段沒有小窗，直接在那一區）。 */
	const row = () => within(grid().getByRole('group', { name: '環節' }));

	async function add(kind: string, name: string) {
		await fireEvent.change(row().getByRole('combobox', { name: '環節的種類' }), { target: { value: kind } });
		await fireEvent.input(row().getByRole('textbox', { name: '環節的名字' }), { target: { value: name } });
		await fireEvent.click(row().getByRole('button', { name: '加入環節' }));
	}

	/** session 現在的 Toss。 */
	const tossOf = (session: EditorSession) => session.flow!.actions.find((a) => a.id === 'x2')!;

	it('加環節：照加的先後排；加第一個就開始記成功率，全部的人第 1 組；存檔不標拍', async () => {
		const session = await openChant();
		await add('whole', '');
		await add('load', '延伸');
		expect(gridPhases()).toEqual(['環節 整體', '環節 上法 延伸']);

		const toss = tossOf(session);
		expect(toss.successRate?.phases).toEqual([
			{ id: 'p1', kind: 'whole', name: '' },
			{ id: 'p2', kind: 'load', name: '延伸' }
		]);
		expect(squadNumbers(toss)).toEqual([1, 1]);
	});

	it('點一個環節選它，改名字、種類、顏色', async () => {
		await openChant();
		await add('whole', '');
		await fireEvent.click(row().getByRole('button', { name: '環節 整體' }));
		await fireEvent.change(row().getByRole('textbox', { name: '這個環節的名字' }), { target: { value: '一趟' } });
		await fireEvent.change(row().getByRole('combobox', { name: '這個環節的種類' }), { target: { value: 'load' } });
		await fireEvent.change(row().getByRole('combobox', { name: '這個環節的顏色' }), { target: { value: '#475569' } });
		const button = row().getByRole('button', { name: '環節 上法 一趟' });
		expect(button.style.getPropertyValue('--c')).toBe('#475569');
	});

	it('選一個環節按清掉就刪掉；刪光就不記成功率；可以復原、重做', async () => {
		const session = await openChant();
		await add('whole', '');
		await add('load', '');
		expect(row().getByRole('button', { name: '清掉環節' }).hasAttribute('disabled')).toBe(true);
		await fireEvent.click(row().getByRole('button', { name: '環節 整體' }));
		await fireEvent.click(row().getByRole('button', { name: '清掉環節' }));
		expect(gridPhases()).toEqual(['環節 上法']);
		await fireEvent.click(row().getByRole('button', { name: '環節 上法' }));
		await fireEvent.click(row().getByRole('button', { name: '清掉環節' }));
		expect(gridPhases()).toEqual([]);
		expect(tossOf(session).successRate).toBeUndefined();

		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(gridPhases()).toEqual(['環節 上法']);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(gridPhases()).toEqual(['環節 整體', '環節 上法']);
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		expect(gridPhases()).toEqual(['環節 上法']);
	});

	it('要刪的環節有記號：先問；取消什麼都不變，確定才刪', async () => {
		let flow = flowOf(addPhase(chantFlow(), 'x2', { kind: 'whole', name: '' }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'load', name: '' }));
		const attempt = { date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } as const;
		await openChant(flowOf(recordAttempt(flow, 'x2', attempt)));
		await fireEvent.click(row().getByRole('button', { name: '環節 整體' }));
		await fireEvent.click(row().getByRole('button', { name: '清掉環節' }));
		const dialog = within(screen.getByRole('alertdialog'));
		expect(dialog.getByText('會刪掉 1 個環節，清掉 1 次的記號，確定就刪掉')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(gridPhases()).toEqual(['環節 整體', '環節 上法']);

		await fireEvent.click(row().getByRole('button', { name: '清掉環節' }));
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定刪除' }));
		expect(gridPhases()).toEqual(['環節 上法']);
	});
});
