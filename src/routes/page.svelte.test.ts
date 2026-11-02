import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeEngine, type FakeEngine } from '#lib/audio/fake-engine.js';
import Page from './+page.svelte';

async function newFlow(engine: FakeEngine = createFakeEngine()) {
	render(Page, { createEngine: () => engine });
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

describe('段、八拍尺、上方列', () => {
	it('「＋」在最後加音樂段，打開段設定；關掉後點段可以再打開', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		expect(screen.getByRole('dialog', { name: '音樂 1 設定' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /音樂 1/ }));
		expect(screen.getByRole('dialog', { name: '音樂 1 設定' })).toBeTruthy();
	});

	it('在八拍尺上點或拖，上方列顯示播放頭的位置', async () => {
		await newFlow();
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋音樂段' }));
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		const ruler = document.querySelector('[data-ruler]')!;
		// 時間軸 1 秒 = 16 px；150 BPM 的 3-5& 在 8.2 秒
		await fireEvent.pointerDown(ruler, { clientX: 8.2 * 16, button: 0 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 3-5&');
		await fireEvent.pointerMove(window, { clientX: 1.6 * 16 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-5');
		await fireEvent.pointerUp(window);
		await fireEvent.pointerMove(window, { clientX: 0 });
		expect(screen.getByLabelText('目前位置').textContent).toBe('音樂 1 1-5');
	});

	it('超過時間規則時上方列提醒；流程設定可以關掉或改數字', async () => {
		await newFlow();
		expect(screen.getByText(/口號段共 0.0 秒，少於 30 秒/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		await fireEvent.change(screen.getByLabelText('口號段最少（秒）'), { target: { value: '0' } });
		expect(screen.queryByText(/口號段共/)).toBeNull();
		await fireEvent.change(screen.getByLabelText('口號段最少（秒）'), { target: { value: '30' } });
		expect(screen.getByText(/口號段共 0.0 秒/)).toBeTruthy();
		await fireEvent.click(screen.getByLabelText('規則警告（只提醒，不擋）'));
		expect(screen.queryByText(/口號段共/)).toBeNull();
	});
});

describe('編輯器首頁', () => {
	it('新建流程後，上方畫出那個場地，沒有換場地的入口', async () => {
		render(Page);
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		await fireEvent.click(screen.getByRole('radio', { name: /5 條橫放/ }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));

		expect(screen.getByText('臺灣盃')).toBeTruthy();
		expect(document.querySelectorAll('[data-strip-number]')).toHaveLength(5);
		expect(screen.queryByRole('radio')).toBeNull();
		expect(screen.queryByText(/場地/, { selector: 'button' })).toBeNull();
	});
});

async function addSegment(kind: '＋音樂段' | '＋口號段') {
	await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
	await fireEvent.click(screen.getByRole('button', { name: kind }));
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
}

/** 等畫面跑一格（播放頭在 requestAnimationFrame 裡更新）。 */
async function nextFrame() {
	await new Promise((r) => requestAnimationFrame(() => r(null)));
	await tick();
}

const position = () => screen.getByLabelText('目前位置').textContent;

describe('播放', () => {
	beforeEach(() => localStorage.clear());

	/** 音樂 1（150 BPM、8 個八拍 = 25.6 秒）→ 口號 1（10 秒）→ 音樂 2 */
	async function sample() {
		const engine = createFakeEngine();
		await newFlow(engine);
		await addSegment('＋音樂段');
		await addSegment('＋口號段');
		await addSegment('＋音樂段');
		return engine;
	}

	it('按播放，播放頭跟著喇叭的時間走，口號段時間照走；再按一次暫停', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.resumed).toBe(true);
		const t0 = engine.clicks[0].when;
		engine.audible = t0 + 8.2;
		await nextFrame();
		expect(position()).toBe('音樂 1 3-5&');
		engine.audible = t0 + 25.6 + 3;
		await nextFrame();
		expect(position()).toBe('口號 1 3.0 秒');
		engine.audible = t0 + 35.6 + 0.4;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-2');

		await fireEvent.click(screen.getByRole('button', { name: '暫停' }));
		expect(engine.clicks).toEqual([]);
		engine.audible = t0 + 50;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-2');
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
	});

	it('從播放頭開始播：口號段沒有節拍器，第一聲是下一個音樂段的第一拍', async () => {
		const engine = await sample();
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, {
			clientX: 26.6 * 16,
			button: 0
		});
		await fireEvent.pointerUp(window);
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		engine.audible = engine.clicks[0].when;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-1');
	});

	it('播放中在八拍尺上點，從那裡接著播', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.pointerDown(document.querySelector('[data-ruler]')!, {
			clientX: 26.6 * 16,
			button: 0
		});
		await fireEvent.pointerUp(window);
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
		engine.audible = engine.clicks[0].when;
		await nextFrame();
		expect(position()).toBe('音樂 2 1-1');
	});

	it('空白鍵播放／暫停；在輸入框裡打字不算', async () => {
		const engine = await sample();
		await fireEvent.keyDown(window, { key: ' ' });
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
		await fireEvent.keyDown(window, { key: ' ' });
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		await fireEvent.keyDown(screen.getByLabelText('延遲校正（毫秒）'), { key: ' ' });
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		expect(engine.clicks).toEqual([]);
	});

	it('節拍器關掉就不響', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByLabelText('節拍器'));
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(engine.clicks).toEqual([]);
		await fireEvent.click(screen.getByLabelText('節拍器'));
		expect(engine.clicks.length).toBeGreaterThan(0);
	});

	it('延遲校正：預設 0，存在瀏覽器；播放頭晚這麼多毫秒', async () => {
		const engine = await sample();
		const field = screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement;
		expect(field.value).toBe('0');
		await fireEvent.change(field, { target: { value: '200' } });
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		engine.audible = engine.clicks[0].when + 8.4;
		await nextFrame();
		expect(position()).toBe('音樂 1 3-5&');

		cleanup();
		await newFlow();
		expect((screen.getByLabelText('延遲校正（毫秒）') as HTMLInputElement).value).toBe('200');
	});

	it('段設定的「▶ 從第一拍聽 2 個八拍」播 16 拍節拍器，播放頭不動', async () => {
		const engine = await sample();
		await fireEvent.click(screen.getByRole('button', { name: /音樂 2/ }));
		await fireEvent.click(screen.getByRole('button', { name: '▶ 從第一拍聽 2 個八拍' }));
		expect(engine.resumed).toBe(true);
		expect(engine.clicks).toHaveLength(16);
		engine.audible = engine.clicks[0].when + 3;
		await nextFrame();
		expect(position()).toBe('音樂 1 1-1');
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
	});
});
