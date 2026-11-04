// 頁面：在場上幫有環節的動作分組（組號小圓、分組浮動列、數字鍵），存檔再打開還在。流程在核心裡做好，放一個帶著它的 session 進頁面。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addPhase,
	setSquad,
	readFlowFile
} from '#lib/core';
import { flowOf, squadNumbers } from '#lib/test-flows.js';
import { editorPage, openFile, phasedFlow, flush, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 點泳道上 Lib 的色條，選到它。 */
const selectLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
const NAMES = ['小美', '小A', '小芳', '小B'];
const ids = (who: string[]) => who.map((w) => `m${NAMES.indexOf(w) + 1}`);
/** 點泳道名字選人：第一個人直接點，後面的 Shift＋點加進來。 */
async function pick(...who: string[]) {
	for (const [i, id] of ids(who).entries()) {
		await fireEvent.click(document.querySelector(`[data-lane="${id}"] .lab`)!, { shiftKey: i > 0 });
	}
}
const picked = () =>
	NAMES.filter((_, i) => document.querySelector(`[data-lane="m${i + 1}"] .lab`)!.getAttribute('aria-pressed') === 'true');
const bar = () => screen.queryByRole('group', { name: '分組' });
const tap = (name: string) => fireEvent.click(within(bar()!).getByRole('button', { name }));
/** 人員清單上的唯讀組標籤。 */
const tagOf = (who: string) =>
	[...document.querySelectorAll('.action-form .people li')]
		.find((li) => li.querySelector('.name')?.textContent === who)
		?.querySelector('.squad-tag')?.textContent ?? null;
const tags = () => NAMES.map(tagOf);
const badge = (who: string) => document.querySelector(`[data-member-id="${ids([who])[0]}"] .badge`);

/** 開編輯頁放 flow、選到 Lib；回傳存下來的檔。 */
async function openPhased(flow = phasedFlow()) {
	const { saves, props } = editorPage(flow);
	render(Page, props);
	await selectLib();
	return saves;
}

describe('場上的組號小圓', () => {
	it('動作的人頭上有組號，沒分組的是灰色「?」；不在動作裡的人沒有', async () => {
		let flow = flowOf(setSquad(phasedFlow(), 'x1', ['m4'], null));
		flow = flowOf(addMembers(flow, [{ name: '小C', gender: 'F', globalRole: 'base' }]));
		await openPhased(flow);
		expect(NAMES.map((w) => badge(w)?.textContent)).toEqual(['1', '1', '1', '?']);
		expect((badge('小B')!.querySelector('circle') as SVGCircleElement).style.fill).toBe('rgb(107, 114, 128)');
		expect(document.querySelector('[data-member-id="m5"] .badge')).toBeNull();
	});

	it('取消選取動作：小圓和浮動列都不見', async () => {
		await openPhased();
		expect(bar()).not.toBeNull();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(bar()).toBeNull();
		expect(badge('小美')).toBeNull();
	});
});

describe('分組浮動列', () => {
	it('寫選了幾個人；選到不在這個動作的人，說他們不算', async () => {
		const flow = flowOf(addMembers(phasedFlow(), [{ name: '小C', gender: 'F', globalRole: 'base' }]));
		await openPhased(flow);
		await pick('小美', '小A');
		expect(bar()!.textContent).toContain('選了 2 人');
		await fireEvent.click(document.querySelector('[data-lane="m5"] .lab')!, { shiftKey: true });
		expect(bar()!.textContent).toContain('另外 1 人不在這個動作，不算');
	});

	it('選人按「＋」放進新的一組；一次改兩個人，復原一步就全部回去', async () => {
		await openPhased();
		await pick('小芳', '小B');
		await tap('放進新的一組');
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 2 組', '第 2 組']);
		expect(badge('小芳')!.textContent).toBe('2');
		await fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 1 組', '第 1 組']);
	});

	it('選人按號碼放進那一組；按「✕」拿出組', async () => {
		await openPhased();
		await pick('小芳', '小B');
		await tap('放進新的一組');
		await pick('小美');
		await tap('放進第 2 組');
		expect(tags()).toEqual(['第 2 組', '第 1 組', '第 2 組', '第 2 組']);
		await pick('小A', '小B');
		await tap('拿出組');
		expect(tags()).toEqual(['第 1 組', '沒分組', '第 1 組', '沒分組']);
		expect(badge('小A')!.textContent).toBe('?');
	});

	it('沒選人：按號碼選起那一組的人；「＋」「✕」按不了', async () => {
		await openPhased(flowOf(setSquad(phasedFlow(), 'x1', ['m3', 'm4'], 2)));
		expect(picked()).toEqual([]);
		expect((within(bar()!).getByRole('button', { name: '放進新的一組' }) as HTMLButtonElement).disabled).toBe(true);
		expect((within(bar()!).getByRole('button', { name: '拿出組' }) as HTMLButtonElement).disabled).toBe(true);
		await tap('選起第 2 組');
		expect(picked()).toEqual(['小芳', '小B']);
	});

	it('「n 人沒分組」點了把他們選起來', async () => {
		await openPhased(flowOf(setSquad(phasedFlow(), 'x1', ['m2', 'm4'], null)));
		await tap('2 人沒分組');
		expect(picked()).toEqual(['小A', '小B']);
	});

	it('存檔再打開，組還在', async () => {
		const saves = await openPhased();
		await pick('小芳', '小B');
		await tap('放進新的一組');
		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await flush();
		const r = readFlowFile(saves[0]);
		if (r.kind !== 'ok') throw new Error(r.message);
		expect(squadNumbers(r.flow.actions[0])).toEqual([1, 1, 2, 2]);
		await openFile(saves[0], '開啟');
		await selectLib();
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 2 組', '第 2 組']);
	});

	it.each([['tumbling'], ['jump']] as const)('%s 的動作有環節也沒有組號小圓和浮動列', async (category) => {
		let flow = teamFlow();
		flow = flowOf(
			addAction(flow, { segmentId: 's1', category, name: '', start: 16, length: 8, note: '', members: [{ memberId: 'm1', role: null }] })
		);
		flow = flowOf(addPhase(flow, 'x2', { kind: 'whole', name: '', beats: { at: 0, len: 8 } }));
		render(Page, editorPage(flow).props);
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x2"]')!);
		expect(bar()).toBeNull();
		expect(badge('小美')).toBeNull();
	});

	it('動作沒有環節：沒有組號小圓和浮動列', async () => {
		await openPhased(teamFlow());
		expect(bar()).toBeNull();
		expect(badge('小美')).toBeNull();
	});
});

describe('數字鍵分組', () => {
	it('選好人按 1–9 放進那組，0 拿出組', async () => {
		await openPhased();
		await pick('小芳', '小B');
		await fireEvent.keyDown(window, { key: '2' });
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 2 組', '第 2 組']);
		await pick('小美');
		await fireEvent.keyDown(window, { key: '0' });
		expect(tags()).toEqual(['沒分組', '第 1 組', '第 2 組', '第 2 組']);
	});

	it('比新的一組還大的號碼、沒選人時不算', async () => {
		await openPhased();
		await pick('小美');
		await fireEvent.keyDown(window, { key: '3' });
		await fireEvent.keyDown(window, { key: 'Escape' });
		await selectLib();
		await fireEvent.keyDown(window, { key: '2' });
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 1 組', '第 1 組']);
	});

	it('焦點在任務角色選單、輸入框時按數字不分組', async () => {
		await openPhased();
		await pick('小芳');
		const role = screen.getByRole('combobox', { name: '小美 的任務角色' });
		role.focus();
		await fireEvent.keyDown(role, { key: '2' });
		const name = screen.getByLabelText('名稱');
		await fireEvent.keyDown(name, { key: '2' });
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 1 組', '第 1 組']);
	});
});

describe('人員清單', () => {
	it('只有唯讀的組標籤，沒有組的選單', async () => {
		await openPhased(flowOf(setSquad(phasedFlow(), 'x1', ['m4'], null)));
		expect(screen.queryByRole('combobox', { name: '小美 的組' })).toBeNull();
		expect(tags()).toEqual(['第 1 組', '第 1 組', '第 1 組', '沒分組']);
	});
});
