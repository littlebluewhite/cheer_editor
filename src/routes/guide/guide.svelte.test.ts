import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Guide from './+page.svelte';

describe('使用說明', () => {
	it('有五章，目錄每一項都連到頁面裡的一節', () => {
		render(Guide);
		for (const name of ['1 這是什麼', '2 先認識幾個詞', '3 排一支流程的八步', '4 每個功能，一步一步', '5 新手試跑']) {
			expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
		}
		const toc = screen.getByRole('navigation', { name: '目錄' });
		for (const link of toc.querySelectorAll('a')) {
			const id = link.getAttribute('href')!.slice(1);
			expect(document.getElementById(id), id).not.toBeNull();
		}
	});

	it('每張圖都有替代文字', () => {
		render(Guide);
		const images = document.querySelectorAll('img');
		expect(images.length).toBe(16);
		for (const img of images) expect(img.alt.length).toBeGreaterThan(10);
	});

	it('有一節講拍點：怎麼選、在拍點小窗怎麼放、怎麼清、哪些情況會拿掉、在哪裡看到', () => {
		render(Guide);
		const toc = screen.getByRole('navigation', { name: '目錄' });
		const link = [...toc.querySelectorAll('a')].find((a) => a.textContent === '4.7 拍點');
		expect(link?.getAttribute('href')).toBe('#cues');
		const section = document.getElementById('cues')!;
		const text = section.textContent!;
		for (const words of ['拍子', '步驟', '手位', '給誰', '拍點小窗', 'Shift', '清掉', '口號段', '八拍表', '大字']) {
			expect(text, words).toContain(words);
		}
		expect(section.querySelector('img')?.alt).toContain('拍點');
	});
});
