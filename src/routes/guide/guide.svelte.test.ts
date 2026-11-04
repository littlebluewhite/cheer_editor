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
		expect(images.length).toBe(19);
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

	it('有一節講練習：在拍點格子加環節、在場上分組、記錄頁、總表、怎麼算、會清掉紀錄的情況', () => {
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
			'成功率', '完成率', '整次成功率', '保留舊紀錄', '清掉重算',
			'拍點格子', '口號段', '改環節', '組號小圓', '分組浮動列', '數字鍵', 'n 人沒分組'
		]) {
			expect(text, words).toContain(words);
		}
		// 拿掉的東西不再出現：記成功率的勾勾、環節清單、組的選單
		for (const gone of ['打開記成功率', '「記成功率」', '環節清單', '選第幾組', '組的選單']) {
			expect(text, gone).not.toContain(gone);
		}
		// 記錄頁和總表都能記一次全上
		expect(text).toContain('在記錄頁最上面或總表按「＋ 記一次全上」');
		// 記號不叫「標記」（標記是圓點上的字）
		expect(text).not.toContain('標記');
		const alts = [...section.querySelectorAll('img')].map((img) => img.alt);
		expect(alts.some((a) => a.includes('記錄頁'))).toBe(true);
		expect(alts.some((a) => a.includes('總表'))).toBe(true);
		expect(alts.some((a) => a.includes('環節') && a.includes('拍點格子'))).toBe(true);
		expect(alts.some((a) => a.includes('分組浮動列'))).toBe(true);
	});

	it('名詞對照表的「組」「環節」跟名詞表一樣：組號不跳號、加第一個環節全部進第 1 組、口號段的環節不標拍', () => {
		render(Guide);
		const row = (word: string) =>
			[...document.querySelectorAll('#words tr')].find((tr) => tr.querySelector('td b')?.textContent === word)!.textContent!;
		expect(row('組')).toContain('組號從 1 連續往下排，不跳號');
		expect(row('組')).toContain('加第一個環節時，全部的人先在第 1 組');
		expect(row('環節')).toContain('在口號段不數拍，環節不標拍');
		expect(row('環節')).toContain('拍被清光，環節就沒了');
	});

	it('「組」只用在成功率：動作是一群隊員，複製人照新的選項文字', () => {
		render(Guide);
		const text = document.body.textContent!;
		expect(text).not.toContain('一組隊員');
		expect(text).not.toContain('整組帶進來');
		expect(text).toContain('從別的動作複製人（連任務角色和組）…');
	});
});
