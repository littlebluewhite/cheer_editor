// 頁面：練習畫面的「記錄」頁（記分段練）。流程在核心裡做好再開檔（同 success-rate.svelte.test.ts）。
// 之後的票（每天的表、總表…）可以在這個檔再加 describe，用一樣的 practiceFlow() 和小工具。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	enableSuccessRate,
	readFlowFile,
	setSquad,
	updateSegment,
	writeFlowFile,
	type CommandResult,
	type Flow
} from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { FileSaver } from '#lib/file/save.js';
import { localDate } from '#lib/local-date.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 開編輯頁（假的音訊引擎、假的存檔），回傳存下來的檔。 */
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

/**
 * 音樂 1（4 個八拍）；小美、小芳是上層，小A、小B 是底層。
 * x1：Lib（技巧，第 1 個八拍），記成功率（上法、中段、下法）；小美、小A 第 1 組，小芳、小B 第 2 組。
 * x2：拋投（第 2 個八拍），還沒打開記成功率；小芳。
 * x3：騰翻（第 3 個八拍），記成功率（整體「騰翻」）；小美、小A。
 */
function practiceFlow(): Flow {
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
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const lib = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '上層' },
		{ memberId: 'm4', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members: lib }));
	flow = flowOf(enableSuccessRate(flow, 'x1'));
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', id, squad));
	}
	const toss = [{ memberId: 'm3', role: '上層' }];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'toss', name: '', start: 16, length: 8, note: '', members: toss }));
	const tumbling = [
		{ memberId: 'm1', role: '騰翻' },
		{ memberId: 'm2', role: '騰翻' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 32, length: 16, note: '', members: tumbling }));
	return flowOf(enableSuccessRate(flow, 'x3'));
}

async function openFile(bytes: Uint8Array, label = '開啟流程檔') {
	const file = new File([bytes as Uint8Array<ArrayBuffer>], '練習用.zip', { type: 'application/zip' });
	await fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
	await settle();
}

/** 開編輯頁、開 practiceFlow()、切到練習。回傳存下來的檔。 */
async function practice() {
	const saves = setup();
	await openFile(writeFlowFile(practiceFlow(), {}));
	await toPractice();
	return saves;
}

const toPractice = () => fireEvent.click(screen.getByRole('button', { name: '練習' }));
const toArrange = () => fireEvent.click(screen.getByRole('button', { name: '編排' }));
/** 左邊清單裡的動作（名字開頭，後面跟著記了幾次）。 */
const pickAction = (label: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
/** 一組（或一個人）的卡。 */
const card = (who: string) => within(screen.getByRole('region', { name: who }));
/** 點卡上一個環節的記號：mark 是成功、小失誤、失敗。 */
const tap = (who: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${who} ${phase} ${mark}` }));
/** 卡片下面那一排：這天的每一次。 */
function dayRow(who: string): (string | undefined)[] {
	const list = card(who).queryByRole('list', { name: '這天的每一次' });
	return list ? within(list).getAllByRole('listitem').map((li) => li.textContent?.trim()) : [];
}
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled;

/** 存檔，讀回存下來的流程。 */
async function saved(saves: Uint8Array[]): Promise<Flow> {
	await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
	await settle();
	const r = readFlowFile(saves.at(-1)!);
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

describe('練習：記錄頁記分段練', () => {
	it('點 ✓ ✓ △ 自動存成一次，卡片下面出現 ✓✓△', async () => {
		await practice();
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		expect(dayRow('第 1 組 小美')).toEqual([]);
		await tap('第 1 組 小美', '下法', '小失誤');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
		expect(dayRow('第 2 組 小芳')).toEqual([]);
	});

	it('點了 ✗ 就存，後面的環節空著', async () => {
		await practice();
		await tap('第 2 組 小芳', '上法', '成功');
		await tap('第 2 組 小芳', '中段', '失敗');
		expect(dayRow('第 2 組 小芳')).toEqual(['✓✗·']);
		await tap('第 2 組 小芳', '上法', '失敗');
		expect(dayRow('第 2 組 小芳')).toEqual(['✓✗·', '✗··']);
	});

	it('只練幾個環節：點選要練的，沒選的按鈕變灰；點完選的就存', async () => {
		const saves = await practice();
		const who = '第 1 組 小美';
		await fireEvent.click(card(who).getByRole('radio', { name: '只練幾個環節' }));
		await fireEvent.click(card(who).getByRole('checkbox', { name: '上法' }));
		await fireEvent.click(card(who).getByRole('checkbox', { name: '下法' }));
		expect(disabled(card(who).getByRole('button', { name: `${who} 中段 成功` }))).toBe(true);

		await tap(who, '上法', '成功');
		expect(dayRow(who)).toEqual([]);
		await tap(who, '下法', '小失誤');
		expect(dayRow(who)).toEqual(['✓·△']);
		// 選的環節留著，下一次照樣只練這幾個
		await tap(who, '上法', '失敗');
		expect(dayRow(who)).toEqual(['✓·△', '✗··']);

		const flow = await saved(saves);
		expect(flow.actions[0].successRate?.records.map((r) => [r.whole, r.marks])).toEqual([
			[false, { p1: '✓', p3: '△' }],
			[false, { p1: '✗' }]
		]);
	});

	it('刪掉上一次：拿掉這組這天最後一次；沒有就不能按', async () => {
		await practice();
		const who = '第 1 組 小美';
		const removeLast = () => card(who).getByRole('button', { name: '刪掉上一次' });
		expect(disabled(removeLast())).toBe(true);
		await tap(who, '上法', '失敗');
		await tap(who, '上法', '成功');
		await tap(who, '中段', '失敗');
		expect(dayRow(who)).toEqual(['✗··', '✓✗·']);
		await fireEvent.click(removeLast());
		expect(dayRow(who)).toEqual(['✗··']);
		await fireEvent.click(removeLast());
		expect(dayRow(who)).toEqual([]);
		expect(disabled(removeLast())).toBe(true);
	});

	it('左邊照流程順序列出有環節的動作和這天記了幾次；騰翻每人一張卡', async () => {
		await practice();
		const list = within(screen.getByRole('list', { name: '記成功率的動作' }));
		expect(list.getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'技巧·Lib 這天 0 次',
			'騰翻 這天 0 次'
		]);
		await tap('第 1 組 小美', '上法', '失敗');
		expect(list.getByRole('button', { name: /^技巧·Lib/ }).textContent).toContain('這天 1 次');

		await pickAction('騰翻');
		expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['練習', '小美', '小A']);
		await tap('小A', '整體 騰翻', '成功');
		expect(dayRow('小A')).toEqual(['✓']);
	});

	it('點到一半就換動作：這一次不存', async () => {
		await practice();
		const who = '第 1 組 小美';
		await tap(who, '上法', '成功');
		await tap(who, '中段', '成功');
		await pickAction('騰翻');
		await pickAction('技巧·Lib');
		expect(card(who).getByRole('button', { name: `${who} 上法 成功` }).getAttribute('aria-pressed')).toBe('false');
		await tap(who, '下法', '成功');
		expect(dayRow(who)).toEqual([]);
	});

	it('點到一半就換到編排：這一次不存', async () => {
		await practice();
		const who = '第 1 組 小美';
		await tap(who, '上法', '成功');
		await tap(who, '中段', '成功');
		await toArrange();
		await toPractice();
		await tap(who, '下法', '成功');
		expect(dayRow(who)).toEqual([]);
	});

	it('存檔再打開，紀錄還在；日期是今天', async () => {
		const saves = await practice();
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		await tap('第 1 組 小美', '下法', '小失誤');

		const flow = await saved(saves);
		expect(flow.actions[0].successRate?.records).toEqual([
			{ id: 't1', date: localDate(), who: 1, practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } }
		]);

		await openFile(saves[0], '開啟');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
	});

	it('練習時開檔、存檔照舊，提示也看得到', async () => {
		await practice();
		await openFile(new TextEncoder().encode('不是 zip'), '開啟');
		expect(screen.getByRole('status').textContent).toBe('這不是流程檔');
	});

	it('日期可以改（練完補打），記在那一天；切到編排再回來還在', async () => {
		const saves = await practice();
		await tap('第 1 組 小美', '上法', '失敗');
		const date = () => screen.getByLabelText('日期') as HTMLInputElement;
		expect(date().value).toBe(localDate());

		await fireEvent.change(date(), { target: { value: '2026-11-01' } });
		expect(dayRow('第 1 組 小美')).toEqual([]);
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '失敗');
		await toArrange();
		await toPractice();
		expect(date().value).toBe('2026-11-01');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✗·']);

		const flow = await saved(saves);
		expect(flow.actions[0].successRate?.records.map((r) => r.date)).toEqual([localDate(), '2026-11-01']);
	});
});

describe('練習：紀錄不進復原', () => {
	/** 在編排幫拋投打開記成功率（復原紀錄多一步），再切到練習。 */
	async function withOneStep() {
		const saves = setup();
		await openFile(writeFlowFile(practiceFlow(), {}));
		await fireEvent.click(document.querySelector('[data-lane="m3"] [data-action-id="x2"]')!);
		await fireEvent.click(screen.getByRole('checkbox', { name: '記成功率' }));
		await toPractice();
		return saves;
	}
	const listed = () =>
		within(screen.getByRole('list', { name: '記成功率的動作' }))
			.getAllByRole('button')
			.map((b) => b.querySelector('.name')?.textContent?.trim());

	it('記了之後按上方列的復原：編排回到上一步，紀錄還在；重做也一樣', async () => {
		await withOneStep();
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		await tap('第 1 組 小美', '下法', '小失誤');

		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(listed()).toEqual(['技巧·Lib', '騰翻']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);

		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
	});

	it('記一次、刪掉上一次不算一步：不推進復原紀錄，也不清掉重做', async () => {
		await withOneStep();
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(disabled(screen.getByRole('button', { name: '復原' }))).toBe(true);
		await tap('第 1 組 小美', '上法', '失敗');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉上一次' }));
		await tap('第 1 組 小美', '上法', '失敗');
		expect(disabled(screen.getByRole('button', { name: '復原' }))).toBe(true);
		expect(disabled(screen.getByRole('button', { name: '重做' }))).toBe(false);
		await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		expect(dayRow('第 1 組 小美')).toEqual(['✗··']);
	});

	it('練習時按 Delete 不會刪掉編排裡選到的動作', async () => {
		setup();
		await openFile(writeFlowFile(practiceFlow(), {}));
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		await toPractice();
		await fireEvent.keyDown(window, { key: 'Delete' });
		await fireEvent.keyDown(window, { key: 'Backspace' });
		expect(listed()).toEqual(['技巧·Lib', '騰翻']);
		await toArrange();
		expect(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')).not.toBeNull();
	});
});
