// 第 3 批的其他小項（#221）：口號段預設、只用鍵盤、長名字、拖到一半按 Esc、分界線……
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { addSegment as addSegmentTo, createFlow, insertFormation, setPositions, updateMember, writeFlowFile } from '#lib/core';
import { editorPage, fakeDraftStore, flush, teamFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const warningList = () => screen.queryByRole('list', { name: '規則警告' });

/** 按時間軸的「在最後加一段」，選 kind 那一項，關掉自己打開的段設定。 */
async function addSegment(kind: '＋音樂段' | '＋口號段') {
	await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
	await fireEvent.click(screen.getByRole('menuitem', { name: kind }));
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
}

describe('新的口號段預設長度（#196 故事 105）', () => {
	it('只有音樂段時加一段口號段：口號段的規則警告不見，不會一加就變成「口號段太短」', async () => {
		render(Page, editorPage(teamFlow()).props);
		expect(warningList()?.textContent).toContain('還沒有口號段');
		await addSegment('＋口號段');
		expect(warningList()?.textContent ?? '').not.toMatch(/口號段/);
	});

	it('口號段已經夠長時再加一段：預設 10 秒', async () => {
		const page = editorPage(teamFlow());
		render(Page, page.props);
		await addSegment('＋口號段');
		await addSegment('＋口號段');
		expect(page.session.flow!.segments.at(-1)).toMatchObject({ kind: 'chant', tenths: 100 });
	});
});

/** 在八拍尺上點 sec 秒（假的版面：1 秒 16 px）。 */
async function seek(sec: number) {
	await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, { clientX: sec * 16, button: 0, altKey: true });
	await fireEvent.pointerUp(window);
}

describe('口號段開頭那張站位的預設出發（#196 故事 98）', () => {
	it('前一段是音樂段：出發是前一段的最後一個八拍（4-1），不是流程開頭', async () => {
		// teamFlow：音樂 1 四個八拍（12.8 秒）→ 口號 1；小美在口號 1 開頭那張站位換了位置
		let flow = flowOf(addSegmentTo(teamFlow(), 'chant'));
		flow = flowOf(setPositions(flow, 'f1', { m1: [0, 0] }));
		flow = flowOf(insertFormation(flow, 12.8));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [4, 0] }));
		render(Page, editorPage(flow).props);
		await seek(12.8);
		expect(screen.getByLabelText<HTMLInputElement>('出發').value).toBe('音樂 1 4-1');
	});
});

describe('長名字滑鼠移上去看得到全名（#196 故事 101）', () => {
	const LONG = '王小美同學是全隊最會喊口號的人之一';

	it('泳道左邊的名字、動作表單「人」那一列的名字：title 是全名', async () => {
		const flow = flowOf(updateMember(libSample(), 'm1', { name: LONG }));
		render(Page, editorPage(flow).props);
		const lane = document.querySelector('[data-lane="m1"] .lab .name')!;
		expect(lane.closest('[title]')!.getAttribute('title')).toContain(LONG);
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		const inForm = within(screen.getByRole('complementary', { name: '右邊欄' })).getByText(LONG);
		expect(inForm.closest('[title]')?.getAttribute('title')).toContain(LONG);
	});

	it('首頁「最近的流程」的名字：title 是全名', async () => {
		const drafts = fakeDraftStore();
		const flow = flowOf(createFlow({ name: LONG, field: { strips: 9, layout: 'vertical' } }));
		drafts.all.set('n1', { bytes: writeFlowFile(flow, {}), savedAt: new Date(2026, 10, 5, 14, 3) });
		render(Page, editorPage(null, { draftStore: drafts.store }).props);
		await flush();
		const name = screen.getByText(LONG);
		expect(name.closest('[title]')?.getAttribute('title')).toContain(LONG);
	});
});

describe('拖到一半按 Esc 取消（#196 故事 102）', () => {
	it('場上拖人：人回到原位，站位不改；放開也不算', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		const before = page.session.flow;
		const dot = () => document.querySelector(`[data-member-id="m1"]`)!;
		const at = dot().getAttribute('transform');
		await fireEvent.pointerDown(dot(), { clientX: 0, clientY: 0, button: 0 });
		await fireEvent.pointerMove(dot(), { clientX: -200, clientY: -300 });
		expect(dot().getAttribute('transform')).not.toBe(at);
		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		expect(dot().getAttribute('transform')).toBe(at);
		await fireEvent.pointerUp(dot(), { clientX: -200, clientY: -300 });
		expect(page.session.flow).toBe(before);
		expect(dot().getAttribute('transform')).toBe(at);
	});

	it('泳道拖色條：色條回到原位，動作不挪', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		const bar = () => document.querySelector<HTMLElement>('[data-lane="m1"] [data-action-id="x1"]')!;
		const left = bar().style.left;
		await fireEvent.pointerDown(bar(), { clientX: 0, button: 0, pointerId: 1 });
		await fireEvent.pointerMove(window, { clientX: 80, pointerId: 1 });
		expect(bar().style.left).not.toBe(left);
		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		expect(bar().style.left).toBe(left);
		await fireEvent.pointerUp(window, { clientX: 80, pointerId: 1 });
		expect(page.session.flow!.actions[0].start).toBe(0);
	});

	it('拖站位小圖：站位不挪', async () => {
		const page = editorPage(flowOf(insertFormation(libSample(), 3.2)));
		render(Page, page.props);
		const before = page.session.flow;
		const thumb = screen.getByRole('button', { name: '站位 2' });
		await fireEvent.pointerDown(thumb, { clientX: 0, button: 0, pointerId: 1 });
		await fireEvent.pointerMove(window, { clientX: 40, pointerId: 1 });
		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await fireEvent.pointerUp(window, { clientX: 40, pointerId: 1 });
		expect(page.session.flow).toBe(before);
	});

	it('拖場地和時間軸的分界：時間軸回到原本的高度', async () => {
		localStorage.clear();
		render(Page, editorPage(libSample()).props);
		const bar = screen.getByRole('separator', { name: '場地和時間軸的分界' });
		const before = bar.getAttribute('aria-valuenow');
		await fireEvent.pointerDown(bar, { clientY: 500, button: 0 });
		await fireEvent.pointerMove(bar, { clientY: 440 });
		expect(bar.getAttribute('aria-valuenow')).not.toBe(before);
		await fireEvent.keyDown(bar, { key: 'Escape' });
		await fireEvent.pointerMove(bar, { clientY: 400 });
		await fireEvent.pointerUp(bar, { clientY: 400 });
		expect(bar.getAttribute('aria-valuenow')).toBe(before);
		expect((document.querySelector('.editor') as HTMLElement).style.getPropertyValue('--timeline-h')).toBe('');
	});
});

describe('只用鍵盤（#196 故事 99）', () => {
	it('焦點在站位小圖上按 Delete 刪掉它：焦點到前一張站位的小圖，不掉回 body', async () => {
		let flow = flowOf(insertFormation(libSample(), 3.2));
		flow = flowOf(insertFormation(flow, 6.4));
		const page = editorPage(flow);
		render(Page, page.props);
		const third = screen.getByRole('button', { name: '站位 3' });
		third.focus();
		await fireEvent.click(third);
		await fireEvent.keyDown(third, { key: 'Delete' });
		expect(page.session.flow!.formations).toHaveLength(2);
		expect(document.activeElement).toBe(screen.getByRole('button', { name: '站位 2' }));
	});

	it('焦點在泳道的色條上按 Delete 刪掉動作：焦點到那一列的名字，不掉回 body', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		const bar = document.querySelector<HTMLElement>('[data-lane="m2"] [data-action-id="x1"]')!;
		bar.focus();
		await fireEvent.click(bar);
		await fireEvent.keyDown(bar, { key: 'Delete' });
		if (screen.queryByRole('button', { name: '確定刪除' })) {
			// 刪動作還在問（#211 之前）：確定以後才算刪掉
			await fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
		}
		expect(page.session.flow!.actions).toHaveLength(0);
		expect(document.activeElement).toBe(document.querySelector('[data-lane="m2"] .lab'));
	});

	it('刪隊員的確認框按 Esc 關掉：人還在，焦點回到那一列的刪除鈕', async () => {
		const page = editorPage(libSample());
		render(Page, page.props);
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		const removeButton = () => screen.getByRole('button', { name: '刪除第 2 位隊員' });
		// 焦點在哪都一樣：還在刪除鈕上，或 Tab 進了確認框
		for (const inside of [false, true]) {
			removeButton().focus();
			await fireEvent.click(removeButton());
			const confirm = screen.getByRole('alertdialog');
			if (inside) within(confirm).getByRole('button', { name: '確定刪除' }).focus();
			await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
			expect(screen.queryByRole('alertdialog')).toBeNull();
			expect(page.session.flow!.members).toHaveLength(4);
			expect(document.activeElement).toBe(removeButton());
		}
	});
});
