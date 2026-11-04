// 頁面：在動作表單的成功率區改環節清單（加、改名、換色、刪、換順序），記錄頁的卡片跟著變。
// 流程在核心裡做好再開檔（同 practice.svelte.test.ts）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	clearPhaseBeats,
	createFlow,
	markPhaseBeats,
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
	const saver: FileSaver = { save: async () => 'saved' };
	render(Page, {
		createEngine: () => createFakeEngine(),
		createSaver: () => saver,
		decode: async () => ({ durationSec: 30, peaks: [] })
	});
}

/** 等 async 的開檔跑完。 */
const settle = () => new Promise((r) => setTimeout(r, 0));

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

/** 音樂 1；Lib（技巧）的環節上法、中段、下法（標了 1-1 到 1-3 再清掉，都沒標拍）；小美、小A 第 1 組。 */
function libFlow(): Flow {
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
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
	for (const [i, kind] of (['load', 'hold', 'dismount'] as const).entries()) {
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind, name: '' }, i * 2, 2));
	}
	return flowOf(clearPhaseBeats(flow, 'x1', 0, 6));
}

async function open() {
	setup();
	const file = new File([writeFlowFile(libFlow(), {}) as Uint8Array<ArrayBuffer>], '練習用.zip');
	await fireEvent.change(screen.getByLabelText('開啟流程檔'), { target: { files: [file] } });
	await settle();
	await selectLib();
}

/** 點泳道上 Lib 的色條，選到它。 */
const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
const toPractice = () => fireEvent.click(screen.getByRole('button', { name: '練習' }));
const toArrange = () => fireEvent.click(screen.getByRole('button', { name: '編排' }));
const rate = () => within(screen.getByRole('group', { name: '成功率' }));
/** 成功率區環節清單的每一列（種類加名字）。 */
const rows = () =>
	within(screen.getByRole('list', { name: '環節' }))
		.getAllByRole('listitem')
		.map((li) => li.getAttribute('aria-label'));
/** 記錄頁卡片上的環節，照順序。 */
const cardPhases = () =>
	[...within(screen.getByRole('region', { name: '第 1 組 小美' })).getAllByRole('button', { name: / 成功$/ })].map(
		(b) => b.getAttribute('aria-label')!.replace(/^第 1 組 小美 | 成功$/g, '')
	);
const tap = (phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `第 1 組 小美 ${phase} ${mark}` }));
const dayRow = () =>
	within(screen.getByRole('list', { name: '這天的每一次' }))
		.getAllByRole('listitem')
		.map((li) => li.textContent?.trim());

describe('改環節清單', () => {
	it('加環節、改名、換色：清單和記錄頁的卡片跟著變', async () => {
		await open();
		await fireEvent.change(rate().getByRole('combobox', { name: '新環節的種類' }), { target: { value: 'load' } });
		await fireEvent.input(rate().getByRole('textbox', { name: '新環節的名字' }), { target: { value: '二層' } });
		await fireEvent.click(rate().getByRole('button', { name: '＋ 加環節' }));
		expect(rows()).toEqual(['上法', '中段', '下法', '上法 二層']);

		await fireEvent.change(rate().getByRole('textbox', { name: '上法 的名字' }), { target: { value: '延伸' } });
		await fireEvent.change(rate().getByRole('combobox', { name: '上法 二層 的顏色' }), {
			target: { value: '#c62828' }
		});
		expect(rows()).toEqual(['上法 延伸', '中段', '下法', '上法 二層']);
		const chip = screen.getByRole('listitem', { name: '上法 二層' }).querySelector('.chip') as HTMLElement;
		expect(chip.style.getPropertyValue('--c')).toBe('#c62828');

		await toPractice();
		expect(cardPhases()).toEqual(['上法 延伸', '中段', '下法', '上法 二層']);
		const cardChip = screen.getByRole('button', { name: '第 1 組 小美 上法 二層 成功' }).closest('.phase')!;
		expect((cardChip.querySelector('.chip') as HTMLElement).style.getPropertyValue('--c')).toBe('#c62828');
	});

	it('換種類；顏色回到種類的顏色', async () => {
		await open();
		await fireEvent.change(rate().getByRole('combobox', { name: '中段 的種類' }), { target: { value: 'transition' } });
		expect(rows()).toEqual(['上法', '轉接', '下法']);
		const colour = rate().getByRole('combobox', { name: '轉接 的顏色' }) as HTMLSelectElement;
		await fireEvent.change(colour, { target: { value: '#475569' } });
		await fireEvent.change(colour, { target: { value: '' } });
		const chip = screen.getByRole('listitem', { name: '轉接' }).querySelector('.chip') as HTMLElement;
		expect(chip.style.getPropertyValue('--c')).toBe('#8d6200');
	});

	it('上移、下移換順序，記錄頁的卡片照新的順序', async () => {
		await open();
		await fireEvent.click(rate().getByRole('button', { name: '把 下法 上移' }));
		expect(rows()).toEqual(['上法', '下法', '中段']);
		await fireEvent.click(rate().getByRole('button', { name: '把 上法 下移' }));
		expect(rows()).toEqual(['下法', '上法', '中段']);
		expect((rate().getByRole('button', { name: '把 下法 上移' }) as HTMLButtonElement).disabled).toBe(true);
		expect((rate().getByRole('button', { name: '把 中段 下移' }) as HTMLButtonElement).disabled).toBe(true);

		await toPractice();
		expect(cardPhases()).toEqual(['下法', '上法', '中段']);
	});

	it('拖一列換順序', async () => {
		await open();
		const row = (label: string) => screen.getByRole('listitem', { name: label });
		await fireEvent.dragStart(row('下法'));
		await fireEvent.dragOver(row('上法'));
		await fireEvent.drop(row('上法'));
		expect(rows()).toEqual(['下法', '上法', '中段']);
	});

	describe('手指', () => {
		afterEach(() => vi.unstubAllGlobals());

		it('不能拖（ADR 0005 不用長按拖），用上移、下移換順序', async () => {
			vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
			await open();
			const row = screen.getByRole('listitem', { name: '下法' });
			expect(row.getAttribute('draggable')).toBe('false');
			await fireEvent.dragStart(row);
			await fireEvent.dragOver(screen.getByRole('listitem', { name: '上法' }));
			await fireEvent.drop(screen.getByRole('listitem', { name: '上法' }));
			expect(rows()).toEqual(['上法', '中段', '下法']);
		});
	});

	it('刪有紀錄的環節：先問會清掉幾次的記號；取消就留著，確定就拿掉，卡片也跟著', async () => {
		await open();
		await toPractice();
		await tap('上法', '成功');
		await tap('中段', '成功');
		await tap('下法', '小失誤');
		expect(dayRow()).toEqual(['✓✓△']);

		await toArrange();
		await selectLib();
		await fireEvent.click(rate().getByRole('button', { name: '刪掉 中段' }));
		const ask = screen.getByRole('alertdialog');
		expect(ask.textContent).toContain('中段 有紀錄，刪掉會清掉 1 次的記號，確定就刪掉');
		await fireEvent.click(within(ask).getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(rows()).toEqual(['上法', '中段', '下法']);

		await fireEvent.click(rate().getByRole('button', { name: '刪掉 中段' }));
		await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '確定' }));
		expect(rows()).toEqual(['上法', '下法']);

		await toPractice();
		expect(cardPhases()).toEqual(['上法', '下法']);
		expect(dayRow()).toEqual(['✓△']);
	});

	it('沒紀錄的環節直接刪；按復原環節回來', async () => {
		await open();
		await fireEvent.click(rate().getByRole('button', { name: '刪掉 中段' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(rows()).toEqual(['上法', '下法']);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(rows()).toEqual(['上法', '中段', '下法']);
	});
});
