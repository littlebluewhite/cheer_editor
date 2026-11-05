import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
		expect(images.length).toBe(20);
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
			'總表', '期間', '練法', '大字看', '明細', '記一次全上', '這個沒做', '後面都沒做', '改第 n 次', '刪掉這一次', '全上', '分段練',
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

	it('名詞對照表的「組」「環節」跟名詞表一樣：組號不跳號、開始分組全部進第 1 組、只有一組時新人進第 1 組、口號段的環節不標拍', () => {
		render(Guide);
		const row = (word: string) =>
			[...document.querySelectorAll('#words tr')].find((tr) => tr.querySelector('td b')?.textContent === word)!.textContent!;
		expect(row('組')).toContain('組號從 1 連續往下排，不跳號');
		expect(row('組')).toContain('加第一個環節時，全部的人先在第 1 組；大類從騰翻、跳躍換成要分組的大類時也一樣');
		expect(row('組')).toContain('動作只有一組時，新加進來、沒帶組的人進第 1 組');
		expect(row('環節')).toContain('在口號段不數拍，環節不標拍');
		expect(row('環節')).toContain('拍被清光，環節就沒了');
	});

	it('第 5 章的編輯器連結開在新分頁，說明頁不會被蓋掉', () => {
		render(Guide);
		const links = [...document.querySelectorAll<HTMLAnchorElement>('#cold-read a[href]')].filter(
			(a) => !a.getAttribute('href')!.startsWith('#')
		);
		expect(links.length).toBeGreaterThan(0);
		for (const a of links) {
			expect(a.target, a.textContent!).toBe('_blank');
			expect(a.rel).toContain('noopener');
		}
	});

	it('用字跟畫面一樣：「整個場地」「移出組」「0 秒」，不寫「全場」「拿出組」「0s」', () => {
		render(Guide);
		const text = document.body.textContent!;
		for (const gone of ['全場', '拿出組', '0s']) expect(text, gone).not.toContain(gone);
		expect(text).toContain('按「整個場地」');
		expect(text).toContain('「✕」移出組');
	});

	it('每個交叉引用（見 4.x、見下面的「…」、（4.x））都是連結，連得到頁面裡的小標題', () => {
		render(Guide);
		const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (n.parentElement!.closest('a')) continue;
			const t = n.textContent!;
			expect(t, t).not.toMatch(/見\s*(上面|下面)|見\s*[0-9圖]|（[0-9]\.[0-9]/);
			// 連結後面不留沒連到的「…」：整句「4.1 的「最近的流程」」都在連結裡
			if (n.previousSibling?.nodeName === 'A') expect(t, t).not.toMatch(/^\s*的「/);
		}
		const links = [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="#"]')];
		expect(links.length).toBeGreaterThan(60);
		for (const a of links) expect(document.getElementById(decodeURIComponent(a.hash.slice(1))), a.textContent!).not.toBeNull();
		// 小標題都有 id，可以直接連過去
		for (const h4 of document.querySelectorAll('main h4')) expect(h4.id, h4.textContent!).not.toBe('');
		expect(document.querySelector('a[href="#最近的流程"]')?.textContent).toBe('4.1 的「最近的流程」');
	});

	it('有一節「隊員怎麼看流程」：開檔、手機的檢視畫面、「我」、八拍表只看自己，不會改到流程', () => {
		render(Guide);
		const toc = screen.getByRole('navigation', { name: '目錄' });
		const link = [...toc.querySelectorAll('a')].find((a) => a.textContent === '4.12 隊員怎麼看流程');
		expect(link?.getAttribute('href')).toBe('#viewers');
		const text = document.getElementById('viewers')!.textContent!;
		for (const words of ['開啟流程檔', '檢視模式', '八拍表這一列', '我', '播放', '印誰', '「編輯」', '只能看、只能播放', '最近的流程', '丟掉']) {
			expect(text, words).toContain(words);
		}
	});

	it('說明跟畫面一樣：練習時播放鍵那一區也藏起來、場上的人按空白鍵是播放、拍點格子一直有環節列', () => {
		render(Guide);
		const row = (word: string) =>
			[...document.querySelectorAll('#words tr')].find((tr) => tr.querySelector('td b')?.textContent === word)!.textContent!;
		expect(row('上方列')).toContain('練習時沒有播放鍵那一區');
		expect(row('拍點格子')).toContain('環節列');
		const keys = document.getElementById('keys')!.textContent!;
		expect(keys).toContain('Tab 停到場上的人，再按 Enter');
		expect(keys).not.toContain('Enter／空白鍵');
		expect(keys).toContain('場上的人');
		expect(document.getElementById('practice')!.textContent).not.toContain('拍點格子多一條「環節」');
	});

	it('試跑的勾選框重新整理後還在', async () => {
		localStorage.clear();
		const first = render(Guide);
		const boxes = () => [...document.querySelectorAll<HTMLInputElement>('#cold-read input[type=checkbox]')];
		await fireEvent.click(boxes()[0]);
		await fireEvent.click(boxes()[2]);
		first.unmount();

		render(Guide);
		await tick();
		expect(boxes().map((b) => b.checked).slice(0, 4)).toEqual([true, false, true, false]);

		await fireEvent.click(boxes()[0]);
		expect(boxes()[0].checked).toBe(false);
		localStorage.clear();
	});

	it('「組」只用在成功率：動作是一群隊員，複製人照新的選項文字', () => {
		render(Guide);
		const text = document.body.textContent!;
		expect(text).not.toContain('一組隊員');
		expect(text).not.toContain('整組帶進來');
		expect(text).toContain('從別的動作複製人（連任務角色和組）…');
	});

	describe('從編輯器打開（網址有 ?from=editor）', () => {
		afterEach(() => {
			history.replaceState(null, '', '/');
			vi.restoreAllMocks();
			vi.useRealTimers();
		});

		it('左上的大標題是關掉這個分頁；關不掉就寫怎麼回編輯器', async () => {
			history.replaceState(null, '', '/guide?from=editor');
			vi.useFakeTimers();
			const close = vi.spyOn(window, 'close').mockImplementation(() => {});
			render(Guide);
			await tick();
			const back = screen.getByRole('button', { name: '關掉這個分頁，回到編輯器' });
			await fireEvent.click(back);
			expect(close).toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(500);
			expect(screen.getByRole('status').textContent).toContain('關不掉這個分頁');
		});

		it('不是從編輯器打開：大標題照舊是連到編輯器的連結', async () => {
			render(Guide);
			await tick();
			expect(screen.queryByRole('button', { name: '關掉這個分頁，回到編輯器' })).toBeNull();
			expect(screen.getByRole('link', { name: '競技啦啦隊流程編輯器' })).toBeTruthy();
		});
	});

	it('窄螢幕也有短提示，和一顆「回目錄」連到目錄', () => {
		render(Guide);
		expect(document.querySelector('.head-hint-short')?.textContent).toBe('關掉分頁回編輯器');
		const top = screen.getByRole('link', { name: '回目錄' });
		expect(document.getElementById(top.getAttribute('href')!.slice(1))).toBe(screen.getByRole('navigation', { name: '目錄' }));
	});
});
