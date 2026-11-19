// 頁面：雲端流程的成功率紀錄（#257，ADR 0011）。記一次送到伺服器（不算復原的一步）；別人記的記號後面寫名字，
// 自己的不寫；別人記的馬上看到；教練改了流程沒存進去的紅條、表、「知道了」；檢視者只看總表。
// 改、刪（#258）：「刪掉我的上一次」只刪自己的；記錄者只能改、刪自己記的，全上只刪自己記的組；別人改、刪的馬上看到。
// 伺服器換成測試共用的假伺服器（fakeServer）：紀錄照真的規則檢查、存、告訴別的房間。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { setSquad, type Attempt, type StoredAttempt } from '#lib/core';
import { localDate } from '#lib/local-date.js';
import { editorPage, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 王教練的「測試」（libSample：Lib 三個環節上法、中段、下法，第 1 組小美、第 2 組小芳），林教練的權限是 role。 */
const wangsFlow = (role: 'editor' | 'recorder' | 'viewer', records: FakeCloudFlow['records'] = []): FakeCloudFlow => ({
	id: 'c1',
	owner: wang.email,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	people: { [lin.email]: role },
	records
});

/** 王教練記的一次：今天、分段練、整個做；沒記號的環節是空著的（blanks，第 10 版起整個做的一次都會記）。 */
const wangs = (id: string, who: string, marks: Attempt['marks']): StoredAttempt & { by: string } => {
	const blanks = ['p1', 'p2', 'p3'].filter((p) => !marks[p]);
	return {
		actionId: 'x1',
		attempt: { id, date: localDate(), who, practice: 'drill', whole: true, marks, ...(blanks.length && { blanks }) },
		by: wang.email
	};
};

/** 林教練登入、打開王教練的「測試」、切到練習。 */
async function open(flow: FakeCloudFlow) {
	const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [flow] });
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: '練習' }));
	return { ...fake, page };
}

const card = (who: string) => within(screen.getByRole('region', { name: who }));
const tap = (who: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${who} ${phase} ${mark}` }));
/** 卡片下面那一排：這天的每一次（記號，別人記的後面寫名字）。 */
function dayRow(who: string): string[] {
	const list = card(who).queryByRole('list', { name: '這天的每一次' });
	return list ? within(list).getAllByRole('listitem').map((li) => li.textContent!.replace(/\s+/g, ' ').trim()) : [];
}

describe('雲端流程記一次', () => {
	it('記一次送到伺服器存起來，記下是誰記的；編排裡不帶紀錄；不算復原的一步；自己記的不寫名字', async () => {
		const s = await open(wangsFlow('recorder'));
		await tap('第 1 組 小美', '上法', '成功');
		await tap('第 1 組 小美', '中段', '成功');
		await tap('第 1 組 小美', '下法', '小失誤');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
		await flush();

		const stored = s.state.flows[0].records!;
		expect(stored.map((r) => [r.actionId, r.attempt.who, r.attempt.marks, r.by])).toEqual([
			['x1', 'g1', { p1: '✓', p2: '✓', p3: '△' }, lin.email]
		]);
		expect(stored[0].attempt.date).toBe(localDate());
		expect(s.state.flows[0].flow.actions[0].successRate!.records).toEqual([]);
		expect(s.page.session.canUndo).toBe(false);
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓△']);
	});

	it('記了一次（存在伺服器）不算還沒存：按「首頁」直接回首頁，不問', async () => {
		const s = await open(wangsFlow('recorder'));
		await tap('第 1 組 小美', '上法', '成功');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
		await flush();
		expect(s.page.session.unsaved).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		await flush();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(s.page.session.flow).toBeNull();
	});

	it('打開時拿到紀錄：別人記的記號後面寫名字，總表的明細也是', async () => {
		await open(wangsFlow('recorder', [wangs('tabc123def456', 'g1', { p1: '✓', p2: '✗' })]));
		expect(dayRow('第 1 組 小美')).toEqual(['✓✗·王教練']);

		await fireEvent.click(screen.getByRole('button', { name: '總表' }));
		await fireEvent.click(screen.getByRole('button', { name: /^第 1 組 小美 上法 / }));
		const detail = within(screen.getByRole('complementary', { name: '明細' }));
		const days = detail.getAllByRole('listitem').filter((li) => li.querySelector('time'));
		expect(days.map((li) => li.textContent!.replace(/\s+/g, ''))).toEqual([`${localDate()}✓王教練`]);
	});

	it('別人記的馬上看到，寫名字；同一組兩個人記，兩次都在', async () => {
		const s = await open(wangsFlow('recorder'));
		await tap('第 1 組 小美', '上法', '失敗');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
		await flush();

		s.recordAs('c1', wang.email, [wangs('tabc123def456', 'g1', { p1: '✓', p2: '✓', p3: '✓' })]);
		await flush();
		expect(dayRow('第 1 組 小美')).toEqual(['✗··', '✓✓✓王教練']);
		expect(s.state.flows[0].records!.length).toBe(2);
	});
});

describe('雲端流程斷線時別人記的（#255）', () => {
	it('連回來時換成伺服器現在的紀錄：斷線時別人記的放進來、刪的拿掉，自己沒傳的留著', async () => {
		const s = await open(wangsFlow('recorder', [wangs('tgone00000001', 'g2', { p1: '✗' })]));
		expect(dayRow('第 2 組 小芳')).toEqual(['✗··王教練']);
		s.disconnect();
		await flush();

		// 斷線時：王教練記了一次、刪了一次；林教練自己記了一次（還沒傳）
		s.recordAs('c1', wang.email, [wangs('tnew000000001', 'g1', { p1: '✓', p2: '✓', p3: '✓' })]);
		s.state.flows[0].records = s.state.flows[0].records!.map((r) => (r.attempt.id === 'tgone00000001' ? { ...r, gone: true } : r));
		await tap('第 1 組 小美', '上法', '小失誤');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
		await flush();

		s.reconnect();
		await flush();
		await flush();
		expect(dayRow('第 1 組 小美').sort()).toEqual(['✓✓✓王教練', '△··'].sort());
		expect(dayRow('第 2 組 小芳')).toEqual([]);
		expect(s.state.flows[0].records!.filter((r) => !r.gone).map((r) => r.by)).toEqual([wang.email, lin.email]);
	});
});

describe('雲端流程沒存進去的紀錄', () => {
	it('教練記的時候改了流程（第 2 組沒有人了）：紅條「這 N 筆沒存進去」、表；卡上拿掉；按「知道了」才清掉', async () => {
		const s = await open(wangsFlow('recorder'));
		s.state.holdRoom = true;
		await tap('第 2 組 小芳', '上法', '成功');
		await fireEvent.click(card('第 2 組 小芳').getByRole('button', { name: '存這一次' }));
		expect(dayRow('第 2 組 小芳')).toEqual(['✓··']);
		// 教練（在別的地方）把小B、小芳換到第 1 組
		s.state.flows[0].flow = flowOf(setSquad(s.state.flows[0].flow, 'x1', ['m3', 'm4'], 1));
		s.releaseRoom();
		await flush();

		const bar = screen.getByRole('alert');
		expect(bar.textContent).toContain('教練改了流程，這 1 筆沒存進去');
		expect(bar.textContent).toContain('你記的時候，教練刪掉了這些環節或組。');
		const row = within(bar).getAllByRole('row')[1];
		expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([localDate(), '技巧·Lib', '第 2 組 小芳', '✓··']);
		expect(dayRow('第 2 組 小芳')).toEqual([]);
		expect(s.state.flows[0].records ?? []).toEqual([]);

		await fireEvent.click(within(bar).getByRole('button', { name: '知道了' }));
		expect(screen.queryByRole('alert')).toBeNull();
	});
});

describe('雲端流程的權限', () => {
	it('檢視者：練習只有總表、看得到紀錄，不能記', async () => {
		const s = await open(wangsFlow('viewer', [wangs('tabc123def456', 'g1', { p1: '✓' })]));
		const pages = within(screen.getByRole('group', { name: '練習的頁' }));
		expect(pages.getAllByRole('button').map((b) => b.textContent)).toEqual(['總表']);
		expect(screen.queryByRole('region', { name: '第 1 組 小美' })).toBeNull();
		expect(screen.getByRole('button', { name: /^第 1 組 小美 上法 / }).textContent).toContain('100%');

		// 程式送的也擋下
		const ask = s.page.session.recordAsk();
		ask.send({ name: 'recordAttempt', args: ['x1', { date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } }] });
		await flush();
		expect(ask.error).toBe('你只能看這支流程');
		expect(s.state.flows[0].records!.length).toBe(1);
	});
});

/** 一次全上裡的一格（by 記的）：今天、同一次全上、整個做。 */
const runEntry = (id: string, who: string, by: string): StoredAttempt & { by: string } => ({
	actionId: 'x1',
	attempt: {
		id,
		date: localDate(),
		who,
		practice: 'runThrough',
		runThroughId: 'rabc123def456',
		runThroughStartedAt: Date.now(),
		whole: true,
		marks: { p1: '✓', p2: '✓', p3: '✓' }
	},
	by
});
/** 存在假伺服器上的紀錄 id（沒清掉的）。 */
const storedIds = (s: { state: { flows: FakeCloudFlow[] } }) =>
	(s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.id);

describe('雲端流程改、刪紀錄（#258）', () => {
	for (const role of ['recorder', 'editor'] as const) {
		it(`「刪掉我的上一次」只刪自己記的上一次（${role === 'editor' ? '編輯者' : '記錄者'}）`, async () => {
			const s = await open(wangsFlow(role));
			await tap('第 1 組 小美', '上法', '失敗');
			await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
			await flush();
			s.recordAs('c1', wang.email, [wangs('tabc123def456', 'g1', { p1: '✓', p2: '✓', p3: '✓' })]);
			await flush();

			await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉我的上一次' }));
			await flush();
			expect(dayRow('第 1 組 小美')).toEqual(['✓✓✓王教練']);
			expect(storedIds(s)).toEqual(['tabc123def456']);
			// 沒有自己記的就按不了。
			expect(card('第 1 組 小美').getByRole('button', { name: '刪掉我的上一次' })).toHaveProperty('disabled', true);
		});
	}

	it('記錄者點別人記的那一次：寫是誰記的，沒有「存修改」「刪掉這一次」', async () => {
		await open(wangsFlow('recorder', [wangs('tabc123def456', 'g1', { p1: '✓' })]));
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: /^改第 1 次/ }));
		const edit = within(screen.getByRole('group', { name: '改第 1 次' }));
		expect(edit.getByText('這一次是王教練記的：你只能改、刪自己記的。')).toBeTruthy();
		expect(edit.queryByRole('button', { name: '存修改' })).toBeNull();
		expect(edit.queryByRole('button', { name: '刪掉這一次' })).toBeNull();
	});

	it('改自己記的那一次：存到伺服器', async () => {
		const s = await open(wangsFlow('recorder'));
		await tap('第 1 組 小美', '上法', '失敗');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
		await flush();
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: /^改第 1 次/ }));
		await fireEvent.click(screen.getByRole('button', { name: '第 1 次 上法 成功' }));
		await fireEvent.click(screen.getByRole('button', { name: '存修改' }));
		await flush();
		expect(s.state.flows[0].records![0].attempt.marks).toEqual({ p1: '✓' });
		expect(dayRow('第 1 組 小美')).toEqual(['✓··']);
	});

	it('刪掉了按「救回」：伺服器上也拿回來', async () => {
		const s = await open(wangsFlow('recorder'));
		await tap('第 1 組 小美', '上法', '失敗');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
		await flush();
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉我的上一次' }));
		await flush();
		expect(storedIds(s)).toEqual([]);
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		expect(storedIds(s).length).toBe(1);
		expect(dayRow('第 1 組 小美')).toEqual(['✗··']);
	});

	it('記錄者：「刪掉我上一次全上記的」只刪自己在那次記的組', async () => {
		const s = await open(
			wangsFlow('recorder', [runEntry('trunwang00010', 'g1', wang.email), runEntry('trunlin000010', 'g2', lin.email)])
		);
		expect(screen.queryByRole('button', { name: '刪掉上一次全上' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '刪掉我上一次全上記的' }));
		await flush();
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('已刪掉你在第 1 次全上記的 1 欄');
		expect(storedIds(s)).toEqual(['trunwang00010']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓✓✓王教練']);
		expect(dayRow('第 2 組 小芳')).toEqual([]);
		expect(screen.getByRole('button', { name: '刪掉我上一次全上記的' })).toHaveProperty('disabled', true);
	});

	it('編輯者：「刪掉上一次全上」整次刪（大家記的都刪）', async () => {
		const s = await open(
			wangsFlow('editor', [runEntry('trunwang00010', 'g1', wang.email), runEntry('trunlin000010', 'g2', lin.email)])
		);
		expect(screen.queryByRole('button', { name: '刪掉我上一次全上記的' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '刪掉上一次全上' }));
		await flush();
		expect(storedIds(s)).toEqual([]);
		expect(dayRow('第 1 組 小美')).toEqual([]);
		expect(dayRow('第 2 組 小芳')).toEqual([]);
	});

	it('別人刪了紀錄、教練的一步改掉紀錄：馬上看到，不用重新整理', async () => {
		const s = await open(
			wangsFlow('recorder', [
				wangs('tabc123def456', 'g1', { p1: '✓' }),
				wangs('tdef456abc123', 'g1', { p1: '✗' }),
				wangs('tghi789abc123', 'g1', { p1: '✓', p3: '✓' })
			])
		);
		const coach = s.joinAs('c1', wang.email);
		coach.room.send({ kind: 'deleteRecords', ids: ['tabc123def456'] });
		await flush();
		expect(dayRow('第 1 組 小美')).toEqual(['✗··王教練', '✓·✓王教練']);

		const deletePhase = { name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } };
		coach.step(deletePhase);
		await flush();
		expect(dayRow('第 1 組 小美')).toEqual(['✗·王教練', '✓·王教練']);
	});
});
