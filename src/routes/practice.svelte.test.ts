// 頁面：練習畫面的「記錄」頁（記分段練）。流程在核心裡做好，放一個帶著它的 session 進頁面，再讀 session 的流程。
// 卡片、全上表、記錄頁的規則在元件測試（AttemptCard、RunThroughSheet、RecordPage），這裡關於它們的只留接線：進練習、進記錄頁。
// 之後的票（每天的表、總表…）可以在這個檔再加 describe，用一樣的 practiceFlow() 和小工具。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	readFlowFile,
	recordAttempt,
	writeFlowFile,
	type Flow,
	type Mark,
	type NewAttempt
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { editorPage, openFile, practiceFlow, flush } from '#lib/test-fakes.js';
import { localDate } from '#lib/local-date.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 開編輯頁、放 practiceFlow()、切到練習。回傳 session 和存下來的檔。 */
async function practice() {
	const page = editorPage(practiceFlow());
	render(Page, page.props);
	await toPractice();
	return page;
}

const toPractice = () => fireEvent.click(screen.getByRole('button', { name: '練習' }));
const toArrange = () => fireEvent.click(screen.getByRole('button', { name: '編排' }));
/** 左邊清單裡的動作（名字開頭，後面跟著記了幾次）。 */
const pickAction = (label: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
/** 一組（或一個人）的卡。 */
const card = (who: string) => within(screen.getByRole('region', { name: who }));
/** 點卡上一個環節的記號：mark 是成功、小失誤、失敗。 */
const tap = (who: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${who} ${phase} ${mark}` }));
/** 卡片下面那一排：這天的每一次。 */
function dayRow(who: string): (string | undefined)[] {
	const list = card(who).queryByRole('list', { name: '這天的每一次' });
	return list ? within(list).getAllByRole('listitem').map((li) => li.textContent?.trim()) : [];
}
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled;
/** 按卡上的「存這一次」（「整個」模式點好才存）。 */
const save = (who: string) => fireEvent.click(card(who).getByRole('button', { name: '存這一次' }));

describe('練習：記錄頁記分段練', () => {
	it('開另一個檔：點了還沒存的記號不帶過去', async () => {
		await practice();
		await tap('第 1 組 小美', '上法', '成功');
		const pressed = () => screen.getByRole('button', { name: '第 1 組 小美 上法 成功' }).getAttribute('aria-pressed');
		expect(pressed()).toBe('true');
		await openFile(writeFlowFile(practiceFlow(), {}), '開啟');
		expect(pressed()).toBe('false');
	});

	it('點到一半就換到編排：這一次不存', async () => {
		await practice();
		const who = '第 1 組 小美';
		await tap(who, '上法', '成功');
		await tap(who, '中段', '成功');
		await toArrange();
		await toPractice();
		await tap(who, '下法', '成功');
		await save(who);
		expect(dayRow(who)).toEqual(['··✓']);
	});

	it('存檔再打開，紀錄還在；日期是今天', async () => {
		const { saves } = await practice();
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		await tap('第 1 組 小美', '下法', '小失誤');
		await save('第 1 組 小美');

		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await flush();
		const r = readFlowFile(saves[0]);
		if (r.kind !== 'ok') throw new Error(r.message);
		const flow = r.flow;
		expect(flow.actions[0].successRate?.records).toEqual([
			{ id: 't1', date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } }
		]);

		await openFile(saves[0], '開啟');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
	});

	it('練習時開檔、存檔照舊，提示也看得到', async () => {
		await practice();
		await openFile(new TextEncoder().encode('不是 zip'), '開啟');
		expect(screen.getByRole('status').textContent).toBe('打不開「練習用.zip」：不是 zip 檔');
	});

	it('日期可以改（練完補打），記在那一天；切到編排再回來還在', async () => {
		const { session } = await practice();
		await tap('第 1 組 小美', '上法', '失敗');
		await save('第 1 組 小美');
		const date = () => screen.getByLabelText('日期') as HTMLInputElement;
		expect(date().value).toBe(localDate());

		await fireEvent.change(date(), { target: { value: '2026-11-01' } });
		expect(dayRow('第 1 組 小美')).toEqual([]);
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '失敗');
		await save('第 1 組 小美');
		await toArrange();
		await toPractice();
		expect(date().value).toBe('2026-11-01');
		expect(dayRow('第 1 組 小美')).toEqual(['✓✗·']);

		const flow = session.flow!;
		expect(flow.actions[0].successRate?.records.map((r) => r.date)).toEqual([localDate(), '2026-11-01']);
	});
});

describe('練習：紀錄不進復原', () => {
	/** 在編排幫拋投的拍點格子選 2-1 到 2-4 加環節「整體 拋投」（復原紀錄多一步），再切到練習。 */
	async function withOneStep() {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(document.querySelector('[data-lane="m3"] [data-action-id="x2"]')!);
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: '2-1' }));
		await fireEvent.click(grid.getByRole('button', { name: '2-4' }), { shiftKey: true });
		const phase = within(within(screen.getByRole('dialog', { name: '拍點小窗' })).getByRole('group', { name: '環節' }));
		await fireEvent.change(phase.getByRole('combobox', { name: '環節的種類' }), { target: { value: 'whole' } });
		await fireEvent.input(phase.getByRole('textbox', { name: '環節的名字' }), { target: { value: '拋投' } });
		await fireEvent.click(phase.getByRole('button', { name: '加入環節' }));
		await toPractice();
	}
	const listed = () =>
		within(screen.getByRole('list', { name: '記成功率的動作' }))
			.getAllByRole('button')
			.map((b) => b.querySelector('.name')?.textContent?.trim());

	it('練習畫面沒有復原、重做：按鈕不在，⌘Z／Ctrl+Z 不會退掉看不到的編排修改', async () => {
		await withOneStep();
		await tap('第 1 組 小美', '上法', '成功');
		expect(screen.queryByRole('button', { name: '復原' })).toBeNull();
		expect(screen.queryByRole('button', { name: '重做' })).toBeNull();
		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		await fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		await toArrange();
		expect(disabled(screen.getByRole('button', { name: '復原' }))).toBe(false);
	});

	it('記了之後回編排按復原：編排回到上一步，紀錄還在；重做也一樣', async () => {
		await withOneStep();
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		await tap('第 1 組 小美', '下法', '小失誤');
		await save('第 1 組 小美');

		await toArrange();
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		await toPractice();
		expect(listed()).toEqual(['技巧·Lib', '騰翻']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);

		await toArrange();
		await fireEvent.click(screen.getByRole('button', { name: '重做' }));
		await toPractice();
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
	});

	it('記一次、刪掉上一次不算一步：不推進復原紀錄，也不清掉重做', async () => {
		await withOneStep();
		await toArrange();
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		expect(disabled(screen.getByRole('button', { name: '復原' }))).toBe(true);
		await toPractice();
		await tap('第 1 組 小美', '上法', '失敗');
		await save('第 1 組 小美');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉上一次' }));
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '救回' }));
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉上一次' }));
		await tap('第 1 組 小美', '上法', '失敗');
		await save('第 1 組 小美');
		await toArrange();
		expect(disabled(screen.getByRole('button', { name: '復原' }))).toBe(true);
		expect(disabled(screen.getByRole('button', { name: '重做' }))).toBe(false);
		await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
		await toPractice();
		expect(listed()).toEqual(['技巧·Lib', '拋投', '騰翻']);
		expect(dayRow('第 1 組 小美')).toEqual(['✗··']);
	});

	it('練習時按 Delete 不會刪掉編排裡選到的動作', async () => {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		await toPractice();
		await fireEvent.keyDown(window, { key: 'Delete' });
		await fireEvent.keyDown(window, { key: 'Backspace' });
		expect(listed()).toEqual(['技巧·Lib', '騰翻']);
		await toArrange();
		expect(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')).not.toBeNull();
	});
});

describe('練習：每天的表和最弱的環節', () => {
	/** 每天的表：每一列的格子（字擠成一行）。 */
	function tableRows(): string[][] {
		const table = screen.getByRole('table', { name: '每天的成功率' });
		return within(table)
			.getAllByRole('row')
			.map((row) => Array.from(row.children).map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
	}
	/** 第 1 組記 ✓✓△、✓✗·、✓✓✓。 */
	async function threeAttempts() {
		const who = '第 1 組 小美';
		await tap(who, '上法', '成功');
		await tap(who, '中段', '成功');
		await tap(who, '下法', '小失誤');
		await save(who);
		await tap(who, '上法', '成功');
		await tap(who, '中段', '失敗');
		await save(who);
		await tap(who, '上法', '成功');
		await tap(who, '中段', '成功');
		await tap(who, '下法', '成功');
		await save(who);
	}

	it('記三次後：今天那一列上法 100%、中段 67%、下法 50%（完成率 100%，2 次），整次 33%；左邊寫最弱的環節', async () => {
		await practice();
		await threeAttempts();
		expect(tableRows()).toEqual([
			['日期', '上法', '中段', '下法', '整次'],
			[localDate(), '100% 完成率 100%・3 次', '67% 完成率 67%・3 次', '50% 完成率 100%・2 次', '33% 3 次'],
			['合計', '100% 完成率 100%・3 次', '67% 完成率 67%・3 次', '50% 完成率 100%・2 次', '33% 3 次']
		]);
		const list = within(screen.getByRole('list', { name: '記成功率的動作' }));
		expect(list.getByRole('button', { name: /^技巧·Lib/ }).textContent).toContain('最弱：下法 50%');
		expect(list.getByRole('button', { name: /^騰翻/ }).textContent).not.toContain('最弱');
	});

	it('沒有紀錄的格子寫「—」；可以只看某一組', async () => {
		await practice();
		expect(tableRows()).toEqual([
			['日期', '上法', '中段', '下法', '整次'],
			['合計', '—', '—', '—', '—']
		]);
		await threeAttempts();
		await tap('第 2 組 小芳', '上法', '失敗');
		await save('第 2 組 小芳');

		const pick = screen.getByLabelText('看哪一組') as HTMLSelectElement;
		expect(Array.from(pick.options).map((o) => o.text)).toEqual(['全部', '第 1 組 小美', '第 2 組 小芳']);
		expect(tableRows()[1].slice(1, 2)).toEqual(['75% 完成率 75%・4 次']);

		await fireEvent.change(pick, { target: { value: 'g2' } });
		expect(tableRows()).toEqual([
			['日期', '上法', '中段', '下法', '整次'],
			[localDate(), '0% 完成率 0%・1 次', '—', '—', '0% 1 次'],
			['合計', '0% 完成率 0%・1 次', '—', '—', '0% 1 次']
		]);
	});

	it('騰翻的動作：可以只看某一個人', async () => {
		await practice();
		await pickAction('騰翻');
		await tap('小A', '整體 騰翻', '成功');
		const pick = screen.getByLabelText('看哪一個人') as HTMLSelectElement;
		expect(Array.from(pick.options).map((o) => o.text)).toEqual(['全部', '小美', '小A']);
		await fireEvent.change(pick, { target: { value: 'm1' } });
		expect(tableRows().at(-1)).toEqual(['合計', '—', '—']);
	});
});

describe('練習：總表', () => {
	/** 一次寫成 '✓✓✗'（照上法、中段、下法；Lib 的環節是 p1 p2 p3）。 */
	function lib(text: string, more: Partial<NewAttempt> = {}): NewAttempt {
		const marks: Record<string, Mark> = {};
		[...text].forEach((m, i) => {
			if (m !== '·') marks[`p${i + 1}`] = m as Mark;
		});
		return { date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks, ...more };
	}
	/**
	 * practiceFlow() 加上紀錄：
	 * Lib 第 2 組 11/4 分段練 ✓✓✓ ×3、✓✓✗ ×2（下法 60%）；第 1 組 11/4 全上 ✓✓△、11/1 分段練 ✗··。
	 * 騰翻 小美 11/4 ✓。
	 */
	function summaryFlow(): Flow {
		let flow = practiceFlow();
		const attempts = [
			...['✓✓✓', '✓✓✓', '✓✓✓', '✓✓✗', '✓✓✗'].map((t) => lib(t, { who: 'g2' })),
			lib('✓✓△', { practice: 'runThrough', runThroughId: 'r1' }),
			lib('✗··', { date: '2026-11-01' })
		];
		for (const a of attempts) flow = flowOf(recordAttempt(flow, 'x1', a));
		const tumbling = flow.actions.find((a) => a.id === 'x3')!.successRate!.phases[0].id;
		const marks = { [tumbling]: '✓' as const };
		return flowOf(recordAttempt(flow, 'x3', { date: '2026-11-04', who: 'm1', practice: 'drill', whole: true, marks }));
	}

	/** 開 summaryFlow()、切到練習、日期改成 2026-11-04、切到總表。 */
	async function summary() {
		render(Page, editorPage(summaryFlow()).props);
		await toPractice();
		await fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-04' } });
		await fireEvent.click(screen.getByRole('button', { name: '總表' }));
	}

	/** 一個動作那一塊的表：每一列的格子（字擠成一行）。 */
	function blockCells(label: string): Element[][] {
		const table = within(screen.getByRole('region', { name: label })).getByRole('table');
		return within(table)
			.getAllByRole('row')
			.map((row) => Array.from(row.children));
	}
	const blockRows = (label: string) => blockCells(label).map((row) => row.map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
	/** 格子的顏色（class 是 good、fair、poor；沒有紀錄沒有）。 */
	const band = (label: string, row: number, col: number) =>
		['good', 'fair', 'poor'].find((b) => blockCells(label)[row][col].classList.contains(b)) ?? null;
	const cell = (who: string, phase: string) => screen.getByRole('button', { name: new RegExp(`^${who} ${phase} `) });
	const filter = (group: string, option: string) =>
		fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name: option }));

	it('每個有記成功率的動作一塊，照流程順序；一列一個環節加整次，一欄一組加合計', async () => {
		await summary();
		const blocks = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
		expect(blocks.filter((b) => b !== '練習')).toEqual(['技巧·Lib', '騰翻']);
		expect(blockRows('技巧·Lib')).toEqual([
			['環節', '第 1 組 小美', '第 2 組 小芳', '合計'],
			['上法', '100% 1 次', '100% 5 次', '100% 6 次'],
			['中段', '100% 1 次', '100% 5 次', '100% 6 次'],
			['下法', '0% 1 次', '60% 5 次', '50% 6 次'],
			['整次', '0% 1 次', '60% 5 次', '50% 6 次']
		]);
		expect(blockRows('騰翻')).toEqual([
			['環節', '小美', '小A', '合計'],
			['整體 騰翻', '100% 1 次', '—', '100% 1 次'],
			['整次', '100% 1 次', '—', '100% 1 次']
		]);
	});

	it('格子的顏色：90% 以上綠、75–89% 黃、75% 以下紅；沒有紀錄沒有顏色', async () => {
		await summary();
		expect(band('技巧·Lib', 3, 2)).toBe('poor'); // 第 2 組下法 60%
		expect(band('技巧·Lib', 1, 2)).toBe('good'); // 第 2 組上法 100%
		expect(band('技巧·Lib', 4, 3)).toBe('poor'); // 整次合計 50%
		expect(band('騰翻', 1, 2)).toBeNull(); // 小A 沒有紀錄
		await filter('期間', '全部');
		expect(blockRows('技巧·Lib')[1][3]).toBe('86% 7 次');
		expect(band('技巧·Lib', 1, 3)).toBe('fair');
	});

	it('換篩選，數字跟著變：期間、練法、大字看完成率', async () => {
		await summary();
		expect(blockRows('技巧·Lib')[1][1]).toBe('100% 1 次');
		await filter('期間', '最近 7 天');
		expect(blockRows('技巧·Lib')[1][1]).toBe('50% 2 次');
		await filter('期間', '11/4');
		await filter('練法', '只看全上');
		expect(blockRows('技巧·Lib')[3]).toEqual(['下法', '0% 1 次', '—', '0% 1 次']);
		await filter('練法', '只看分段練');
		expect(blockRows('技巧·Lib')[3]).toEqual(['下法', '—', '60% 5 次', '60% 5 次']);
		await filter('練法', '全部');
		await filter('大字看', '完成率');
		expect(blockRows('技巧·Lib')[3]).toEqual(['下法', '100% 1 次', '60% 5 次', '67% 6 次']);
		// 整次一律是整次成功率：切到完成率時寫清楚
		expect(blockRows('技巧·Lib')[4]).toEqual(['整次成功率', '0% 1 次', '60% 5 次', '50% 6 次']);
		await filter('大字看', '成功率');
		expect(blockRows('技巧·Lib')[4][0]).toBe('整次');
	});

	it('期間的第一個選項寫出選的日期；選的是今天才寫「今天」', async () => {
		await summary();
		const options = () => within(screen.getByRole('group', { name: '期間' })).getAllByRole('button').map((b) => b.textContent?.trim());
		expect(options()).toEqual(['11/4', '最近 7 天', '全部']);
		await fireEvent.click(screen.getByRole('button', { name: '記錄' }));
		await fireEvent.change(screen.getByLabelText('日期'), { target: { value: localDate() } });
		await fireEvent.click(screen.getByRole('button', { name: '總表' }));
		const [, m, d] = localDate().split('-').map(Number);
		expect(options()[0]).toBe(`今天 ${m}/${d}`);
	});

	it('明細照格子的篩選：11/4＋只看分段練，只列 11/4 分段練的那幾次', async () => {
		await summary();
		await filter('練法', '只看分段練');
		await fireEvent.click(cell('第 2 組 小芳', '下法'));
		const days = () =>
			within(screen.getByRole('complementary', { name: '明細' }))
				.getAllByRole('listitem')
				.filter((li) => li.querySelector('time'))
				.map((li) => li.textContent?.replace(/\s+/g, ''));
		expect(days()).toEqual(['2026-11-04✓✓✓✗✗']);
		// 第 1 組 11/4 只有全上：分段練沒有
		await fireEvent.click(cell('第 1 組 小美', '上法'));
		expect(within(screen.getByRole('complementary', { name: '明細' })).getByText('還沒有紀錄')).toBeTruthy();
		// 換篩選，打開著的明細跟著變
		await filter('期間', '全部');
		expect(days()).toEqual(['2026-11-01✗']);
	});

	it('點格子：右邊滑出這組、這個環節每天的每一次，全上的有標出來；可以關掉', async () => {
		await summary();
		await filter('期間', '全部');
		await fireEvent.click(cell('第 1 組 小美', '上法'));
		const detail = within(screen.getByRole('complementary', { name: '明細' }));
		expect(detail.getByRole('heading').textContent).toBe('第 1 組 小美 上法');
		const days = detail.getAllByRole('listitem').filter((li) => li.querySelector('time'));
		expect(days.map((li) => li.textContent?.replace(/\s+/g, ''))).toEqual(['2026-11-01✗', '2026-11-04✓全上']);

		await fireEvent.click(cell('第 2 組 小芳', '下法'));
		expect(within(screen.getByRole('complementary', { name: '明細' })).getByRole('heading').textContent).toBe('第 2 組 小芳 下法');

		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		expect(screen.queryByRole('complementary', { name: '明細' })).toBeNull();
	});

	it('總表跟記錄共用日期', async () => {
		await summary();
		await fireEvent.click(screen.getByRole('button', { name: '記錄' }));
		expect((screen.getByLabelText('日期') as HTMLInputElement).value).toBe('2026-11-04');
	});

	describe('記一次全上', () => {
		/** 打開記全上的表。 */
		async function openSheet() {
			await summary();
			await fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
		}
		/** 表上一個動作的格子，一列一個環節（字擠成一行）。 */
		const sheetRows = (label: string) =>
			within(within(screen.getByRole('region', { name: '記一次全上' })).getByRole('region', { name: label }))
				.getAllByRole('row')
				.map((row) => Array.from(row.children).map((c) => c.textContent?.trim() ?? ''));
		/** 表上的一格（讀屏：誰 環節 記號）。 */
		const slot = (who: string, phase: string) =>
			within(screen.getByRole('region', { name: '記一次全上' })).getByRole('button', {
				name: new RegExp(`^${who} ${phase} `)
			});
		const tapSlot = async (who: string, phase: string, times = 1) => {
			for (let i = 0; i < times; i++) await fireEvent.click(slot(who, phase));
		};
		const stopped = (label: string) =>
			within(within(screen.getByRole('region', { name: '記一次全上' })).getByRole('region', { name: label })).getByRole(
				'button',
				{ name: '沒做（停了）' }
			);

		it('存這次全上：做到 Lib 就停了，Lib 第 2 組下法 ✗；總表只看全上多一次 ✗，騰翻沒有多；明細標著全上', async () => {
			await openSheet();
			await tapSlot('第 2 組 小芳', '下法', 2);
			await fireEvent.click(stopped('騰翻'));
			await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));

			expect(screen.queryByRole('region', { name: '記一次全上' })).toBeNull();
			expect(screen.getByRole('status').textContent).toBe('已存這次全上');
			await filter('練法', '只看全上');
			expect(blockRows('技巧·Lib')[3]).toEqual(['下法', '50% 2 次', '0% 1 次', '33% 3 次']);
			expect(blockRows('技巧·Lib')[4]).toEqual(['整次', '50% 2 次', '0% 1 次', '33% 3 次']);
			expect(blockRows('騰翻')[1]).toEqual(['整體 騰翻', '—', '—', '—']);

			await fireEvent.click(cell('第 2 組 小芳', '下法'));
			const marks = within(screen.getByRole('complementary', { name: '明細' })).getAllByRole('listitem');
			expect(marks.filter((li) => li.classList.contains('run')).map((li) => li.textContent)).toEqual(['✗全上']);
		});

		it('改過格子按取消：先問，選「丟掉」什麼都不存', async () => {
			await openSheet();
			await tapSlot('第 2 組 小芳', '下法', 2);
			await fireEvent.click(screen.getByRole('button', { name: '取消' }));
			expect(screen.getByRole('region', { name: '記一次全上' })).toBeTruthy();
			await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '丟掉' }));
			expect(screen.queryByRole('region', { name: '記一次全上' })).toBeNull();
			await filter('練法', '只看全上');
			expect(blockRows('技巧·Lib')[3]).toEqual(['下法', '0% 1 次', '—', '0% 1 次']);
			// 再打開是新的一張，每格又是 ✓。
			await fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
			expect(sheetRows('技巧·Lib')[3]).toEqual(['下法', '✓', '✓']);
		});
	});
});

describe('練習：日期', () => {
	it('最晚選到今天：日期框的 max 是今天，打了未來的日子就回到原來的日期', async () => {
		await practice();
		const date = () => screen.getByLabelText('日期') as HTMLInputElement;
		expect(date().max).toBe(localDate());
		await fireEvent.change(date(), { target: { value: '2999-01-01' } });
		expect(date().value).toBe(localDate());
		await fireEvent.change(date(), { target: { value: '2026-11-01' } });
		expect(date().value).toBe('2026-11-01');
	});
});
