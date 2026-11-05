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
