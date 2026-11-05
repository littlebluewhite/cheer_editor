import { addSegment, createFlow, insertFormation, type CommandResult, type Flow } from '#lib/core';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import FormationRow from './FormationRow.svelte';

function ok(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

describe('站位列的小圖', () => {
	it('跟下一張站位靠太近時變窄，不蓋到下一張；再近也留得下號碼；最後一張照原本寬', () => {
		let flow = ok(addSegment(ok(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
		for (const sec of [4, 20, 21]) flow = ok(insertFormation(flow, sec));
		const { container } = render(TestSession, {
			props: { editor: testEditor(flow).editor, component: FormationRow, props: { pxPerSec: 16 } }
		});
		const widths = [...container.querySelectorAll<HTMLElement>('.th')].map((t) => t.style.width);
		// 0 秒和 4 秒差 64 px → 60 px；4 和 20 差很遠 → 80；20 和 21 只差 16 px → 最窄 44；最後一張 80。
		expect(widths).toEqual(['60px', '80px', '44px', '80px']);
	});

	it('好幾張站位很靠近時錯開排（上下分層），每張都不疊到別張；不靠近的照原本的高度', () => {
		let flow = ok(addSegment(ok(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
		// 20、20.4、20.8 秒：16 px／秒只差 6.4 px，三張擠在一起；4 秒那張離得遠
		for (const sec of [4, 20, 20.4, 20.8]) flow = ok(insertFormation(flow, sec));
		const { container } = render(TestSession, {
			props: { editor: testEditor(flow).editor, component: FormationRow, props: { pxPerSec: 16 } }
		});
		const rects = [...container.querySelectorAll<HTMLElement>('.th')].map((t) => ({
			left: parseFloat(t.style.left),
			top: parseFloat(t.style.top),
			width: parseFloat(t.style.width),
			height: parseFloat(t.style.height)
		}));
		expect(rects).toHaveLength(5);
		const overlap = (a: (typeof rects)[0], b: (typeof rects)[0]) =>
			a.left < b.left + b.width &&
			b.left < a.left + a.width &&
			a.top < b.top + b.height &&
			b.top < a.top + a.height;
		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
		}
		// 每張都還有能點的高度；沒擠在一起的照原本 64 px 高
		for (const r of rects) expect(r.height).toBeGreaterThanOrEqual(18);
		expect(rects[0].height).toBe(64);
		expect(rects[1].height).toBe(64);
	});
});
