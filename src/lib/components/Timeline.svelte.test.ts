import { addSegment, createFlow, insertFormation, updateSegment, type Flow } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import Timeline from './Timeline.svelte';

/** 一個音樂段：150 BPM、8 個八拍 = 25.6 秒。 */
function oneSegment(): Flow {
	return flowOf(addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
}

function setup(flow = oneSegment()) {
	const { container } = render(TestSession, {
		props: {
			editor: testEditor(flow).editor,
			component: Timeline,
			props: { onopensegment: () => {} }
		}
	});
	return container.querySelector('.timeline') as HTMLElement;
}

describe('時間軸放大縮小', () => {
	it('按「＋」「−」改倍數，畫面上看得到現在幾倍', async () => {
		setup();
		expect(screen.getByText('×1.0')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸放大' }));
		expect(screen.getByText('×1.5')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸縮小' }));
		await fireEvent.click(screen.getByRole('button', { name: '時間軸縮小' }));
		expect(screen.getByText('×0.8')).toBeTruthy();
	});

	it('Ctrl／⌘＋滾輪放大縮小；沒按 Ctrl／⌘ 的滾輪不動倍數', async () => {
		const timeline = setup();
		await fireEvent.wheel(timeline, { deltaY: -100 });
		expect(screen.getByText('×1.0')).toBeTruthy();
		await fireEvent.wheel(timeline, { deltaY: -100, ctrlKey: true });
		expect(screen.getByText('×1.5')).toBeTruthy();
		await fireEvent.wheel(timeline, { deltaY: 100, metaKey: true });
		await fireEvent.wheel(timeline, { deltaY: 100, metaKey: true });
		expect(screen.getByText('×0.8')).toBeTruthy();
	});

	it('iPad 兩指捏合（Safari 的 gesturechange）放大縮小時間軸，不放大整頁', async () => {
		const timeline = setup();
		const gesture = async (type: string, scale: number) => {
			const e = Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 300 });
			await fireEvent(timeline, e);
			return e;
		};
		expect((await gesture('gesturestart', 1)).defaultPrevented).toBe(true);
		await gesture('gesturechange', 1.1);
		expect(screen.getByText('×1.0')).toBeTruthy();
		expect((await gesture('gesturechange', 1.4)).defaultPrevented).toBe(true);
		expect(screen.getByText('×1.5')).toBeTruthy();
		await gesture('gesturechange', 1.4 / 1.3 / 1.3 / 1.01);
		expect(screen.getByText('×1.0')).toBeTruthy();
	});

	it('「符合寬度」：整支流程剛好放滿現在的寬度，沒有橫向捲軸；再按「＋」接回一般倍數', async () => {
		const timeline = setup();
		// 音樂段 25.6 秒、1 秒 16 px：看得到 148（名字欄）＋ 25.6 × 16 × 1.5 ＋ 16（尾巴）px 時剛好 ×1.5
		Object.defineProperty(timeline, 'clientWidth', { value: 148 + 25.6 * 16 * 1.5 + 16, configurable: true });
		await fireEvent.click(screen.getByRole('button', { name: '符合寬度' }));
		expect(screen.getByText('×1.5')).toBeTruthy();
		const inner = timeline.querySelector('.inner') as HTMLElement;
		expect(parseFloat(inner.style.width)).toBeCloseTo(timeline.clientWidth, 6);

		Object.defineProperty(timeline, 'clientWidth', { value: 148 + 25.6 * 16 * 0.6 + 16 });
		await fireEvent.click(screen.getByRole('button', { name: '符合寬度' }));
		expect(screen.getByText('×0.6')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸放大' }));
		expect(screen.getByText('×0.8')).toBeTruthy();
	});

	it('觸控板捏合的小事件累積夠了才動一格', async () => {
		const timeline = setup();
		await fireEvent.wheel(timeline, { deltaY: -15, ctrlKey: true });
		await fireEvent.wheel(timeline, { deltaY: -15, ctrlKey: true });
		expect(screen.getByText('×1.0')).toBeTruthy();
		await fireEvent.wheel(timeline, { deltaY: -15, ctrlKey: true });
		expect(screen.getByText('×1.5')).toBeTruthy();
	});
});

/**
 * 時間軸看得到的寬：jsdom 不算版面，從 HTMLElement 的 clientWidth 給（時間軸一畫出來就量）；
 * resize() 換寬度、叫假的 ResizeObserver（像換視窗大小）。
 */
let observers: (() => void)[] = [];
let viewWidth = 0;
function fakeView(width: number) {
	viewWidth = width;
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => viewWidth, configurable: true });
	globalThis.ResizeObserver = class {
		constructor(private cb: () => void) {}
		observe() {
			observers.push(this.cb);
		}
		disconnect() {}
		unobserve() {}
	} as unknown as typeof ResizeObserver;
}
async function resize(width: number) {
	viewWidth = width;
	for (const cb of observers) cb();
	await tick();
}
afterEach(() => {
	delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
	delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
	observers = [];
});

/** 時間軸寬到流程放得下 k 倍：名字欄 148 ＋ 25.6 秒 × 16 px × k ＋ 尾巴 16。 */
const fits = (k: number) => 148 + 25.6 * 16 * k + 16;

describe('自動符合寬度', () => {
	it('流程比畫面短：一打開就放滿；換視窗大小也跟著放滿', async () => {
		fakeView(fits(2));
		setup();
		expect(screen.getByText('×2.0')).toBeTruthy();
		await resize(fits(1.5));
		expect(screen.getByText('×1.5')).toBeTruthy();
	});

	it('流程比畫面長：維持 ×1，不縮小；按「符合寬度」才縮', async () => {
		fakeView(fits(0.5));
		setup();
		expect(screen.getByText('×1.0')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '符合寬度' }));
		expect(screen.getByText('×0.5')).toBeTruthy();
		// 按過「符合寬度」：換視窗大小也維持放滿
		await resize(fits(0.4));
		expect(screen.getByText('×0.4')).toBeTruthy();
	});

	it('自己按「＋」「−」之後，換視窗大小不改倍數', async () => {
		fakeView(fits(1.5));
		setup();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸放大' }));
		expect(screen.getByText('×2.0')).toBeTruthy();
		await resize(fits(3));
		expect(screen.getByText('×2.0')).toBeTruthy();
	});

	it('加段之後重新放滿', async () => {
		fakeView(fits(3));
		const timeline = setup();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸縮小' }));
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
		const inner = timeline.querySelector('.inner') as HTMLElement;
		expect(parseFloat(inner.style.width)).toBeCloseTo(fits(3), 6);
	});

	it('最後一張站位的縮圖也放得下，不跑出畫面', async () => {
		// 站位在 24 秒（最後 1.6 秒）：縮圖 80 px 比流程結尾還右邊
		fakeView(1000);
		const timeline = setup(flowOf(insertFormation(oneSegment(), 24)));
		await fireEvent.click(screen.getByRole('button', { name: '符合寬度' }));
		const inner = timeline.querySelector('.inner') as HTMLElement;
		const last = [...timeline.querySelectorAll<HTMLElement>('.th')].at(-1)!;
		expect(148 + parseFloat(last.style.left) + parseFloat(last.style.width)).toBeLessThanOrEqual(1000 + 1e-6);
		expect(parseFloat(inner.style.width)).toBeLessThanOrEqual(1000 + 1e-6);
	});
});

describe('段列', () => {
	/** 一個音樂段後面接一個 0.1 秒的口號段。 */
	function setupShortChant() {
		let flow = flowOf(addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
		flow = flowOf(addSegment(flow, 'chant'));
		flow = flowOf(updateSegment(flow, flow.segments[1].id, { seconds: 0.1 }));
		render(TestSession, {
			props: {
				editor: testEditor(flow).editor,
				component: Timeline,
				props: { onopensegment: () => {} }
			}
		});
	}

	it('段上的字放不下時，滑過去看得到完整的字', () => {
		setupShortChant();
		expect(screen.getByRole('button', { name: /^音樂 1/ }).title).toMatch(/^音樂 1　\d+ BPM/);
		expect(screen.getByRole('button', { name: /^口號 1/ }).title).toMatch(/^口號 1　0\.1 秒/);
	});

	it('很短的段也有點得到的寬度', () => {
		setupShortChant();
		expect(parseFloat(screen.getByRole('button', { name: /^口號 1/ }).style.width)).toBeGreaterThanOrEqual(16);
	});

	it('放大後捲到段的中間：段名移到看得到的左邊，不跟著捲走；捲到段尾也不超出這一段', async () => {
		const timeline = setup();
		const seg = screen.getByRole('button', { name: /^音樂 1/ });
		expect(seg.style.paddingLeft).toBe('8px');
		timeline.scrollLeft = 300;
		await fireEvent.scroll(timeline);
		expect(seg.style.paddingLeft).toBe('308px');
		// 段寬 25.6 × 16 − 2 = 407.6 px：段名最多移到右邊留 100 px 的地方
		timeline.scrollLeft = 1000;
		await fireEvent.scroll(timeline);
		expect(parseFloat(seg.style.paddingLeft)).toBeCloseTo(8 + 407.6 - 100, 6);
	});
});
