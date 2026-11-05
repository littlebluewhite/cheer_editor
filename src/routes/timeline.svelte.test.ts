// 時間軸上拖動作長度（#152）：拖的時候看得到新的長度和結束拍；重疊時訊息寫上一個動作在哪裡結束。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { addAction } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 範例流程（Lib 1-1 到 2-1，小A 在裡面），加小A 的騰翻在 3-2 開始。時間軸 ×1：1 秒 16 px。 */
function setup() {
	const flow = flowOf(
		addAction(libSample(), {
			segmentId: 's1',
			category: 'tumbling',
			name: '',
			start: 34,
			length: 8,
			note: '',
			members: [{ memberId: 'm2', role: null }]
		})
	);
	const { session, props } = editorPage(flow);
	render(Page, props);
	// 150 BPM：半拍 0.2 秒 = 3.2 px
	const halfPx = 0.2 * 16;
	return { session, halfPx };
}

const bar = (id: string) => document.querySelector<HTMLElement>(`[data-lane="m2"] [data-action-id="${id}"]`)!;
const readout = () => document.querySelector<HTMLElement>('[data-resize-readout]');

describe('時間軸上拖動作長度', () => {
	it('拖的時候寫新的長度和在哪一拍結束；放開就收起來', async () => {
		const { session, halfPx } = setup();
		await fireEvent.pointerDown(bar('x1').querySelector('[data-resize]')!, { clientX: 100, button: 0 });
		expect(readout()).toBeNull();
		// 往右 17 個半拍：16.5 拍，在 3-1& 結束
		await fireEvent.pointerMove(window, { clientX: 100 + 17 * halfPx });
		expect(readout()!.textContent).toBe('16.5 拍・在 3-1& 結束');
		await fireEvent.pointerUp(window, { clientX: 100 + 17 * halfPx });
		expect(readout()).toBeNull();
		expect(session.flow!.actions[0].length).toBe(33);
	});

	it('拖到跟別的動作重疊：寫上一個動作在哪裡結束', async () => {
		const { halfPx } = setup();
		const drag = async (el: Element, dx: number) => {
			await fireEvent.pointerDown(el, { clientX: 100, button: 0 });
			await fireEvent.pointerMove(window, { clientX: 100 + dx });
			await fireEvent.pointerUp(window, { clientX: 100 + dx });
		};
		await drag(bar('x1').querySelector('[data-resize]')!, 17 * halfPx);
		// 騰翻往前挪一拍到 3-1：Lib 還沒結束
		await drag(bar('x2'), -2 * halfPx);
		expect(await screen.findByText(/小A 同一時間已經在「技巧·Lib」裡：上一個動作在 3-1& 才結束/)).toBeTruthy();
	});
});

describe('播放頭', () => {
	it('時間軸上那條播放頭的線本身也能拖（不只八拍尺）', async () => {
		setup();
		const line = document.querySelector<HTMLElement>('[data-playhead-line]')!;
		// 150 BPM 一拍 0.4 秒：拖到 3-5（8 秒）
		await fireEvent.pointerDown(line, { clientX: 0, button: 0 });
		await fireEvent.pointerMove(window, { clientX: 8 * 16 });
		await fireEvent.pointerUp(window, { clientX: 8 * 16 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5');
	});
});

describe('點色條、跳到動作開始（#170）', () => {
	const where = () => screen.getByLabelText('目前位置').textContent;

	it('點一下色條：只選到動作，播放頭不動', async () => {
		const { session } = setup();
		await fireEvent.click(bar('x2'));
		expect(session.selectedActionId).toBe('x2');
		expect(where()).toBe('音樂 1 1-1');
	});

	it('雙擊色條：播放頭跳到動作開始', async () => {
		const { session } = setup();
		// 瀏覽器雙擊會先送兩個 click
		await fireEvent.click(bar('x2'));
		await fireEvent.click(bar('x2'));
		await fireEvent.dblClick(bar('x2'));
		expect(session.selectedActionId).toBe('x2');
		expect(where()).toBe('音樂 1 3-2');
	});

	it('按動作表單的「跳到開始」：播放頭跳到動作開始', async () => {
		setup();
		await fireEvent.click(bar('x2'));
		await fireEvent.click(screen.getByRole('button', { name: '跳到開始' }));
		expect(where()).toBe('音樂 1 3-2');
	});
});
