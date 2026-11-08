// 裁短（#212）：把動作條拖過段尾，停在段尾；段變短時確認清單分「裁短」和「刪掉」兩組，有紀錄會不見時先問。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addAction, insertFormation, recordAttempt, updateSegment, type Flow } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 時間軸 ×1：1 秒 16 px；150 BPM 半拍 0.2 秒 = 3.2 px。 */
const halfPx = 0.2 * 16;

const bar = (lane: string, id: string) => document.querySelector<HTMLElement>(`[data-lane="${lane}"] [data-action-id="${id}"]`)!;

async function drag(el: Element, dx: number) {
	await fireEvent.pointerDown(el, { clientX: 100, button: 0 });
	await fireEvent.pointerMove(window, { clientX: 100 + dx });
	await fireEvent.pointerUp(window, { clientX: 100 + dx });
}

describe('把動作條拖過段尾', () => {
	/** libSample（音樂 1 有 4 個八拍 = 64 個半拍），加小A 的跳躍在 4-5（56）開始、2 拍。 */
	function open() {
		const flow = flowOf(
			addAction(libSample(), {
				segmentId: 's1',
				category: 'jump',
				name: 'T',
				start: 56,
				length: 4,
				note: '',
				members: [{ memberId: 'm2', role: null }]
			})
		);
		const { session, props } = editorPage(flow);
		render(Page, props);
		return session;
	}

	it('拖色條往右過段尾：動作停在段尾（裁短），不是彈回原位', async () => {
		const session = open();
		// 往右 6 個半拍：開始 62，段尾 64，只留 2 個半拍
		await drag(bar('m2', 'x2'), 6 * halfPx);
		expect(session.flow!.actions[1]).toMatchObject({ start: 62, length: 2 });
	});

	it('拉右邊過段尾：結束停在段尾，拖的時候寫的長度也停在段尾', async () => {
		const session = open();
		await fireEvent.pointerDown(bar('m2', 'x2').querySelector('[data-resize]')!, { clientX: 100, button: 0 });
		// 往右 10 個半拍：從 4-5 到段尾只有 4 拍
		await fireEvent.pointerMove(window, { clientX: 100 + 10 * halfPx });
		expect(document.querySelector('[data-resize-readout]')!.textContent).toBe('4 拍・在 5-1 結束');
		await fireEvent.pointerUp(window, { clientX: 100 + 10 * halfPx });
		expect(session.flow!.actions[1]).toMatchObject({ start: 56, length: 8 });
	});
});

describe('段變短的確認清單', () => {
	/**
	 * 音樂 1 只有 1 個八拍；Lib 1-1 到 1-8（上法 1-1 到 1-2、中段 1-3 到 1-6、下法 1-7 到 1-8），
	 * 第 1 組練過一次只記了下法；站位 2 在 1-8。
	 */
	function open() {
		let flow: Flow = flowOf(updateSegment(libSample(), 's1', { eights: 1, lastBeats: 8 }));
		const lib = flow.actions[0];
		const dismount = lib.successRate!.phases[2].id;
		flow = flowOf(
			recordAttempt(flow, 'x1', { date: '2026-11-04', who: lib.members[0].squad!, practice: 'drill', whole: true, marks: { [dismount]: '✓' } })
		);
		flow = flowOf(insertFormation(flow, 14 * 0.2));
		const { session, props } = editorPage(flow);
		render(Page, props);
		return session;
	}

	it('分「裁短」和「刪掉」兩組列出；下法有紀錄會不見，先問、寫按「復原」紀錄會回來；按確定才改', async () => {
		const session = open();
		const before = session.flow;
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		const settings = within(screen.getByRole('dialog', { name: '音樂 1 設定' }));
		// 6 拍 = 12 個半拍：Lib 裁短到 1-6，下法刪掉；站位 2（1-8）在段外
		await fireEvent.change(settings.getByLabelText('最後一個八拍有幾拍'), { target: { value: '6' } });
		const confirm = screen.getByRole('alertdialog');
		expect(within(confirm).getByText(/縮短後/).textContent).toBe(
			'音樂 1 縮短後，超出段尾的動作裁短到段尾，放不進段裡的刪掉，會一起清掉 1 次紀錄（清掉的紀錄按「復原」會回來）'
		);
		expect(within(confirm).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
			'裁短：動作「技巧·Lib」（1-1 起）8 拍 → 6 拍，會刪掉 1 個環節（清掉 1 次的記號）',
			'刪掉：站位 2（1-8）'
		]);
		expect(session.flow).toBe(before);

		await fireEvent.click(within(confirm).getByRole('button', { name: '確定刪除' }));
		const lib = session.flow!.actions[0];
		expect(lib.length).toBe(12);
		expect(lib.successRate!.phases).toHaveLength(2);
		expect(lib.successRate!.records).toEqual([]);
		expect(session.flow!.formations).toHaveLength(1);
	});

	it('只會裁短、沒有要刪的：訊息不寫刪掉、按鈕寫「確定裁短」；按了提示「已改第 1 段的八拍數」旁邊有復原（N19、N21）', async () => {
		const { session, props } = editorPage(flowOf(updateSegment(libSample(), 's1', { eights: 1, lastBeats: 8 })));
		render(Page, props);
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		const settings = within(screen.getByRole('dialog', { name: '音樂 1 設定' }));
		await fireEvent.change(settings.getByLabelText('最後一個八拍有幾拍'), { target: { value: '6' } });
		const confirm = screen.getByRole('alertdialog');
		expect(within(confirm).getByText(/縮短後/).textContent).toBe('音樂 1 縮短後，超出段尾的動作裁短到段尾');
		expect(within(confirm).queryByRole('button', { name: '確定刪除' })).toBeNull();
		await fireEvent.click(within(confirm).getByRole('button', { name: '確定裁短' }));
		expect(session.flow!.actions[0].length).toBe(12);
		expect(session.notice).toBe('已改第 1 段的八拍數');
		expect(session.noticeButton?.label).toBe('復原');
	});
});
