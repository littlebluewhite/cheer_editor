// 頁面：雲端流程的復原、重做（#256，ADR 0014）。復原也是一步：送那一步改到的東西改之前的樣子（重做送改之後的），
// 別人改的別的東西留著。那些東西後來被別的分頁改過：提示「王教練後來改過，這步不能復原」，跳過；再按一次試前一步。重做一樣。
// 伺服器換成測試共用的假伺服器（fakeServer）：別人用 joinAs 在別的地方打開、送步。
// 這裡只留按鈕的接線（按復原、重做 → 房間、提示；被退回的提示；復原帶回紀錄後練習的表）。其他情況（後來改過不能重做、
// 方向鍵連按、清掉和退回時紀錄跟伺服器對得上）在 Node：src/lib/undo-log.test.ts（#320，測試名字一樣）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { takeRecords, type Attempt } from '#lib/core';
import { editorPage, fromMenu, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 林教練登入，打開他的「測試」（libSample，紀錄是 records）；王教練是編輯者，也開著。 */
async function bothOpen(records: FakeCloudFlow['records'] = []) {
	const fake = fakeServer({
		users: [lin, wang],
		signedIn: lin.email,
		flows: [
			{
				id: 'c1',
				owner: lin.email,
				flow: libSample(),
				updatedAt: new Date(2026, 10, 7).toISOString(),
				people: { [wang.email]: 'editor' },
				records
			}
		]
	});
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	const w = fake.joinAs('c1', wang.email);
	await flush();
	return { ...fake, page, w };
}

/** 流程設定改流程名字。 */
async function rename(name: string) {
	await fromMenu('流程設定');
	await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: name } });
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
	await flush();
}

/** 加一段口號（林教練）。 */
async function addSegment(s: Awaited<ReturnType<typeof bothOpen>>) {
	s.page.session.ask.send({ name: 'addSegment', args: ['chant'] });
	await flush();
}

async function press(button: '復原' | '重做') {
	await fireEvent.click(screen.getByRole('button', { name: button }));
	await flush();
}

const status = () => screen.getByRole('status').textContent;

describe('雲端流程的復原、重做', () => {
	it('復原送伺服器，別人改的別的東西留著；重做也送', async () => {
		const s = await bothOpen();
		await rename('全國賽');
		s.w.step({ name: 'addSegment', args: ['chant'] });
		await flush();

		await press('復原');
		expect(status()).toBe('已復原：改流程名字');
		const server = s.state.flows[0];
		expect(server.flow.name).toBe('測試');
		expect(server.flow.segments).toHaveLength(2);
		expect(s.page.session.flow).toEqual(server.flow);

		await press('重做');
		expect(server.flow.name).toBe('全國賽');
		expect(s.page.session.flow).toEqual(server.flow);
	});

	it('被退回的步不算：復原不會試它', async () => {
		const s = await bothOpen();
		await addSegment(s);
		s.state.holdRoom = true;
		s.w.step({ name: 'renameFlow', args: ['區賽'] });
		await rename('全國賽');
		s.releaseRoom();
		await flush();
		expect(status()).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');

		await press('復原');
		expect(status()).toBe('已復原：加第 2 段');
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		expect(s.page.session.canUndo).toBe(false);
	});
});

describe('復原帶回這一步清掉的紀錄（ADR 0007）', () => {
	/** 王教練記的一次：11/4 分段練、整個做、第 1 組。 */
	const wangs = (id: string, marks: Attempt['marks']) => ({
		actionId: 'x1',
		attempt: { id, date: '2026-11-04', who: 'g1', practice: 'drill' as const, whole: true, marks },
		by: wang.email
	});
	/** 練習的總表：每天的成功率。 */
	async function rates(): Promise<string[][]> {
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const table = screen.getByRole('table', { name: '每天的成功率' });
		const rows = within(table)
			.getAllByRole('row')
			.map((row) => Array.from(row.children).map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		return rows;
	}

	it('復原刪環節：清掉的記號、整筆清掉的那一次都回來，成功率跟刪之前一樣（N02）；重做再清一次', async () => {
		// 兩次都在下法失敗
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓', p3: '✗' })]);
		const before = await rates();
		const records = () => takeRecords(s.page.session.flow!).records;
		const kept = records();
		const server = () => (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt);
		expect(kept).toHaveLength(2);

		s.page.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		await flush();
		expect(server().map((a) => a.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);

		await press('復原');
		expect(server()).toEqual(kept.map((r) => r.attempt));
		expect(records()).toEqual(kept);
		expect(await rates()).toEqual(before);

		await press('重做');
		expect(server().map((a) => a.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);
		expect(records().map((r) => r.attempt.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);
	});
});
