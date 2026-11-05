// 頁面：場地放大縮小和平移（#151）。
// 縮放到上下限時按鈕停用、圓點照倍數開根號放大、放大後滾輪是平移（Ctrl／⌘＋滾輪才縮放）、條號固定在畫面邊上。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const zoomText = () => document.querySelector('.field-wrap .zoom')!.textContent;
const svg = () => screen.getByRole('group', { name: '場地' });
const viewBox = () => svg().getAttribute('viewBox')!.split(' ').map(Number);

function open() {
	render(Page, editorPage(teamFlow()).props);
}

async function zoomIn(times: number) {
	for (let i = 0; i < times; i++) await fireEvent.click(button('放大'));
}

describe('場地縮放的按鈕', () => {
	it('×1 時「縮小」停用；放大到最大，「放大」停用', async () => {
		open();
		expect(button('縮小').disabled).toBe(true);
		expect(button('放大').disabled).toBe(false);
		await zoomIn(20);
		expect(zoomText()).toBe('×8.0');
		expect(button('放大').disabled).toBe(true);
		expect(button('縮小').disabled).toBe(false);
	});

	it('圓點照倍數開根號放大：×4 時圓點在場地單位裡縮成一半（螢幕上是 2 倍大，不是 4 倍）', async () => {
		open();
		const scale = () => {
			const t = document.querySelector('[data-member-id="m1"] > g')!.getAttribute('transform')!;
			return Number(/scale\((.+)\)/.exec(t)![1]);
		};
		expect(scale()).toBe(1);
		await zoomIn(20);
		for (let i = 0; i < 3; i++) await fireEvent.click(button('縮小'));
		// 8 ÷ 1.25³ ≈ 4.1
		expect(scale()).toBeCloseTo(1 / Math.sqrt(8 / 1.25 ** 3), 6);
	});
});

describe('放大後平移', () => {
	it('×1 時滾輪不縮放；放大後滾輪是平移、倍數不變；Ctrl／⌘＋滾輪才縮放，滾一大格也只放大一點', async () => {
		open();
		await fireEvent.wheel(svg(), { deltaY: -100, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×1.0');
		await zoomIn(4);
		const [x, y] = viewBox();
		await fireEvent.wheel(svg(), { deltaY: 100, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×2.4');
		expect(viewBox()[1]).toBeGreaterThan(y);
		await fireEvent.wheel(svg(), { deltaX: -100, clientX: 0, clientY: 0 });
		expect(viewBox()[0]).toBeLessThan(x);
		// Shift＋滾輪（滑鼠沒有橫的滾輪）：左右平移
		const [x2] = viewBox();
		await fireEvent.wheel(svg(), { deltaY: 100, shiftKey: true, clientX: 0, clientY: 0 });
		expect(viewBox()[0]).toBeGreaterThan(x2);
		await fireEvent.wheel(svg(), { deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×3.1');
		await fireEvent.wheel(svg(), { deltaY: 100, metaKey: true, clientX: 0, clientY: 0 });
		expect(zoomText()).toBe('×2.4');
	});

	it('放大後條號固定在畫面邊上：捲到哪都看得到', async () => {
		open();
		await zoomIn(8);
		const [, y, , h] = viewBox();
		const ys = [...document.querySelectorAll('[data-strip-number]')].map((el) => Number(el.getAttribute('y')));
		expect(ys.length).toBeGreaterThan(0);
		for (const n of ys) {
			expect(n).toBeGreaterThan(y);
			expect(n).toBeLessThan(y + h);
		}
	});
});
