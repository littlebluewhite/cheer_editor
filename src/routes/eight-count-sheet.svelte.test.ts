// 八拍表（#217）：小站位圖用同一個範圍、寫走位的出發時間和口號段動作的長度、沒有動作時有提示、
// 「我」選了誰「印誰」就預設是誰。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	insertFormation,
	setPositions,
	updateSegment,
	writeFlowFile,
	type Flow
} from '#lib/core';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { editorPage, flush, openFile } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

beforeEach(() => localStorage.clear());

const sheet = () => screen.getByRole('dialog', { name: '八拍表' });
const chosen = () => (within(sheet()).getByLabelText('印誰') as HTMLSelectElement).selectedOptions[0].textContent;

async function openSheet(flow: Flow) {
	render(Page, editorPage(flow).props);
	await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
}

describe('八拍表的內容', () => {
	it('站位寫走位的出發時間；口號段的動作寫從幾秒到幾秒和長度', async () => {
		// 範例流程（150 BPM，一個八拍 3.2 秒）：第 3 個八拍開頭（3-1）插站位 2，小美換位置，預設往前一個八拍（2-1）出發；
		// 後面加口號 1（10 秒），2.3 秒開始喊 2 秒
		let flow = flowOf(insertFormation(libSample(), 6.4));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
		flow = flowOf(addSegment(flow, 'chant'));
		flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
		flow = flowOf(
			addAction(flow, { segmentId: 's2', category: 'other', name: '喊', start: 23, length: 20, note: '', members: [{ memberId: 'm1', role: null }] })
		);
		await openSheet(flow);
		const captions = [...sheet().querySelectorAll('figcaption')].map((f) => f.textContent);
		expect(captions).toEqual(['站位 1・1-1', '站位 2・3-1（2-1 出發）']);
		expect(sheet().textContent).toContain('2.3 到 4.3 秒・2.0 秒');
	});

	it('每張小站位圖的範圍都一樣（全部站位裡有人的地方合起來）', async () => {
		let flow = flowOf(insertFormation(libSample(), 8));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [6, 6] }));
		await openSheet(flow);
		const boxes = [...sheet().querySelectorAll('figure svg')].map((s) => s.getAttribute('viewBox'));
		expect(boxes).toHaveLength(2);
		expect(boxes[1]).toBe(boxes[0]);
	});

	it('流程還沒有動作：表上有提示，不是一張空白', async () => {
		let flow = flowOf(createFlow({ name: '新的', field: { strips: 9, layout: 'vertical' } }));
		flow = flowOf(addMembers(flow, [{ name: '小美', gender: 'F', globalRole: 'top' }]));
		flow = flowOf(addSegment(flow, 'music'));
		await openSheet(flow);
		expect(within(sheet()).getByRole('note').textContent).toContain('還沒有動作');
	});

	it('有動作就沒有提示', async () => {
		await openSheet(libSample());
		expect(within(sheet()).queryByRole('note')).toBeNull();
	});
});

describe('「印誰」照「我」', () => {
	beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN })));
	afterEach(() => vi.unstubAllGlobals());

	it('手機上「我」選小A，打開八拍表：預設印小A', async () => {
		const page = editorPage(null);
		render(Page, page.props);
		await flush();
		await openFile(writeFlowFile(libSample(), {}));
		await fireEvent.change(screen.getByLabelText('我'), { target: { value: 'm2' } });
		await fireEvent.click(screen.getByRole('button', { name: '八拍表' }));
		expect(chosen()).toBe('小A');
	});
});
