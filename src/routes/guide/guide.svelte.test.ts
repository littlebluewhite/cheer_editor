import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Guide from './+page.svelte';

describe('使用說明', () => {
	it('有五章，目錄每一項都連到頁面裡的一節', () => {
		render(Guide);
		for (const name of ['1 這是什麼', '2 先認識幾個詞', '3 排一支流程的八個步驟', '4 每個功能，一步一步', '5 新手試跑']) {
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
		expect(images.length).toBe(18);
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

	it('有一節講練習：怎麼打開記成功率、記錄頁、總表、怎麼算、會清掉紀錄的情況', () => {
		render(Guide);
		const toc = screen.getByRole('navigation', { name: '目錄' });
		const link = [...toc.querySelectorAll('a')].find((a) => a.textContent === '4.10 練習');
		expect(link?.getAttribute('href')).toBe('#practice');
		const section = document.getElementById('practice')!;
		const text = section.textContent!;
		for (const words of [
			'記成功率', '環節', '上法', '中段', '轉接', '下法', '整體', '標拍', '組', '每個人自己算',
			'記號', '成功', '小失誤', '失敗', '整個', '只練幾個環節', '刪掉上一次', '復原',
			'總表', '期間', '練法', '大字看', '明細', '記一次全上', '沒做（停了）', '全上', '分段練',
			'成功率', '完成率', '整次成功率', '保留舊紀錄', '清掉重算'
		]) {
			expect(text, words).toContain(words);
		}
		// 記號不叫「標記」（標記是圓點上的字）
		expect(text).not.toContain('標記');
		const alts = [...section.querySelectorAll('img')].map((img) => img.alt);
		expect(alts.some((a) => a.includes('記錄頁'))).toBe(true);
		expect(alts.some((a) => a.includes('總表'))).toBe(true);
	});

	it('「組」只用在成功率：動作是一群隊員，複製人照新的選項文字', () => {
		render(Guide);
		const text = document.body.textContent!;
		expect(text).not.toContain('一組隊員');
		expect(text).not.toContain('整組帶進來');
		expect(text).toContain('從別的動作複製人（連任務角色和組）…');
	});
});
