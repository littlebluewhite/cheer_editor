// 頁面：一起記全上（#262，ADR 0015）。有人在記時記錄頁、總表上方藍條＋「加入，記別的組」；按「＋ 記一次全上」先問加入還是開新的；
// 全上表最上面「我記哪幾組」（照組號跨動作一起選，騰翻、跳躍每個人一顆）每顆下面寫誰記；別人記的欄變灰、格子「—」；
// 存檔鈕寫「存這次全上（你記的 N 欄）」；拿不到的提示；同一次同一組別人先存了，進「沒存進去」寫「王教練已經記了…」。
// 伺服器換成測試共用的假伺服器（fakeServer）：誰在表裡、誰拿著哪幾組照真的規則。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredAttempt } from '#lib/core';
import { localDate } from '#lib/local-date.js';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { editorPage, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { ratedSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 王教練的「測試」（ratedSample：Lib 第 1 組小美、第 2 組小芳；騰翻小美、小A），林教練是記錄者。 */
const wangsFlow = (): FakeCloudFlow => ({
	id: 'c1',
	owner: wang.email,
	flow: ratedSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	people: { [lin.email]: 'recorder' }
});

const settle = async () => {
	for (let i = 0; i < 4; i++) await flush();
};

/** 林教練登入、打開王教練的「測試」、切到練習。 */
async function open() {
	const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow()] });
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await settle();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await settle();
	await fireEvent.click(screen.getByRole('button', { name: '練習' }));
	return { ...fake, page };
}

/** 王教練開的全上（今天 9:05 開的）。 */
const RUN = 'rwang0000001x';
const STARTED = new Date(new Date().setHours(9, 5, 0, 0)).getTime();
/** 王教練（在別的手機上）開一次全上，拿著 keys、點過 touched。 */
function wangOpens(s: Awaited<ReturnType<typeof open>>, keys: string[], touched: string[] = []) {
	const coach = s.joinAs('c1', wang.email);
	coach.room.send({ kind: 'runThrough', id: RUN, date: localDate(), startedAt: STARTED, keys, touched, joining: false });
	return coach;
}

/** 「我記哪幾組」每顆的字（組、下面的小字）。 */
const picks = () =>
	within(screen.getByRole('group', { name: '我記哪幾組' }))
		.getAllByRole('button')
		.map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
/** 「我記哪幾組」裡這一組的那顆。 */
const pickOf = (label: string) =>
	within(screen.getByRole('group', { name: '我記哪幾組' })).getByRole('button', { name: new RegExp(`^${label} `) });
const saveButton = () => screen.getByRole('button', { name: /^存這次全上/ }) as HTMLButtonElement;
/** 全上表裡一個動作的欄名（組名和下面的小字）。 */
const heads = (action: string) =>
	within(screen.getByRole('region', { name: action }))
		.getAllByRole('columnheader')
		.slice(1)
		.map((th) => th.textContent!.replace(/\s+/g, ' ').trim());

describe('有人在記全上', () => {
	it('藍條寫誰在記第幾次、幾點開的；按「＋ 記一次全上」問加入還是開新的', async () => {
		const s = await open();
		wangOpens(s, ['n:1', 'n:2', 'm:m1', 'm:m2'], ['n:1']);
		await settle();

		const bar = screen.getByRole('status', { name: '有人在記全上' });
		expect(bar.textContent).toContain('● 王教練在記今天第 1 次全上（9:05 開的）');
		expect(within(bar).getByRole('button', { name: '加入，記別的組' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
		const ask = within(screen.getByRole('dialog', { name: '王教練在記今天第 1 次全上' }));
		expect(ask.getByText('9:05 開的。一組在一次全上只能一個人記。')).toBeTruthy();
		expect(ask.getByRole('button', { name: '開新的一次：只有你記，算第 2 次' })).toBeTruthy();
		await fireEvent.click(ask.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('dialog')).toBeNull();

		// 開新的：只有自己，每組都是自己的
		await fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
		await fireEvent.click(screen.getByRole('button', { name: '開新的一次：只有你記，算第 2 次' }));
		await settle();
		expect(screen.getByRole('heading', { name: '記一次全上' })).toBeTruthy();
		expect(picks()).toEqual(['第 1 組 你記', '第 2 組 你記', '小美 你記', '小A 你記']);
	});

	it('按「＋ 記一次全上」再按「加入這一次」：加入王教練那一次，不是開新的', async () => {
		const s = await open();
		wangOpens(s, ['n:1', 'm:m1'], ['n:1']);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
		await fireEvent.click(screen.getByRole('button', { name: '加入這一次：跟王教練一起記，你記別的組' }));
		await settle();

		expect(screen.getByRole('heading', { name: '加入王教練的第 1 次全上' })).toBeTruthy();
		expect(picks()).toEqual(['第 1 組 王教練在記', '第 2 組 你記', '小美 王教練拿著', '小A 你記']);
	});

	it('加入：沒人拿著的組先勾好；別人記的欄變灰、格子「—」；存檔鈕寫你記的幾欄；被接手馬上變灰', async () => {
		const s = await open();
		const coach = wangOpens(s, ['n:1', 'm:m1'], ['n:1']);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '加入，記別的組' }));
		await settle();

		expect(screen.getByRole('heading', { name: '加入王教練的第 1 次全上' })).toBeTruthy();
		expect(picks()).toEqual(['第 1 組 王教練在記', '第 2 組 你記', '小美 王教練拿著', '小A 你記']);
		expect(heads('技巧·Lib')).toEqual(['第 1 組 小美 王教練在記', '第 2 組 小芳']);
		expect(heads('騰翻')).toEqual(['小美 王教練拿著・還沒點', '小A']);
		expect(screen.getByRole('button', { name: '第 1 組 小美 上法 別人記的' }).textContent).toBe('—');
		expect(saveButton().textContent).toBe('存這次全上（你記的 2 欄）');

		// 王教練接手第 2 組（林教練還沒點過）：那一欄馬上變灰
		const linId = s.state.users.findIndex((u) => u.email === lin.email) + 1;
		coach.room.send({ kind: 'claim', run: RUN, key: 'n:2', from: linId });
		await settle();
		expect(picks()).toEqual(['第 1 組 王教練在記', '第 2 組 王教練拿著', '小美 王教練拿著', '小A 你記']);
		expect(saveButton().textContent).toBe('存這次全上（你記的 1 欄）');

		// 小A 也放掉：一欄都沒有，存不了
		await fireEvent.click(pickOf('小A'));
		await settle();
		expect(picks()[3]).toBe('小A 沒人記');
		expect(saveButton().textContent).toBe('存這次全上（你記的 0 欄）');
		expect(saveButton().disabled).toBe(true);
	});

	it('拿不走點過的組：提示「王教練已經點了第 1 組，拿不走」；沒點過的拿得到', async () => {
		const s = await open();
		wangOpens(s, ['n:1', 'n:2'], ['n:1']);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '加入，記別的組' }));
		await settle();

		await fireEvent.click(pickOf('第 1 組'));
		await settle();
		expect(screen.getByRole('alert').textContent).toBe('王教練已經點了第 1 組，拿不走');
		await fireEvent.click(pickOf('第 2 組'));
		await settle();
		expect(picks()[1]).toBe('第 2 組 你記');
	});
});

describe('同一次全上同一組只收先存的', () => {
	it('王教練先存了第 2 組：我存的那一欄進「沒存進去」，寫「王教練已經記了這次全上的第 2 組」', async () => {
		const s = await open();
		wangOpens(s, ['n:1', 'm:m1', 'm:m2']);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '加入，記別的組' }));
		await settle();
		expect(saveButton().textContent).toBe('存這次全上（你記的 1 欄）');

		s.state.holdRoom = true;
		await fireEvent.click(saveButton());
		// 王教練斷線時記了第 2 組，比我先傳上來
		const his: StoredAttempt = {
			actionId: 'x1',
			attempt: {
				id: 'twang0000002x',
				date: localDate(),
				who: 'g2',
				practice: 'runThrough',
				runThroughId: RUN,
				runThroughStartedAt: STARTED,
				whole: true,
				marks: { p1: '✓', p2: '✓', p3: '✓' }
			}
		};
		s.recordAs('c1', wang.email, [his]);
		s.releaseRoom();
		await settle();

		const bar = screen.getByRole('alert');
		expect(bar.textContent).toContain('這 1 筆沒存進去');
		expect(bar.textContent).toContain('王教練已經記了這次全上的第 2 組');
		expect((s.state.flows[0].records ?? []).map((r) => r.by)).toEqual([wang.email]);
	});
});

describe('沒存進去的那一列照現在的語言寫（ADR 0017）', () => {
	afterEach(() => localStorage.setItem(localStorageKey, 'zh-TW'));

	/** 王教練的第 2 組（這次全上）。 */
	const squad2 = (id: string): StoredAttempt => ({
		actionId: 'x1',
		attempt: {
			id,
			date: localDate(),
			who: 'g2',
			practice: 'runThrough',
			runThroughId: RUN,
			runThroughStartedAt: STARTED,
			whole: true,
			marks: { p1: '✓', p2: '✓', p3: '✓' }
		}
	});

	/** 我（中文畫面）存了這次全上的第 2 組；伺服器回答前，first 先把第 2 組存了，然後畫面換成英文。回「沒存進去」那一條的字。 */
	async function savedAfter(first: (s: Awaited<ReturnType<typeof open>>) => void) {
		const s = await open();
		wangOpens(s, ['n:1', 'm:m1', 'm:m2']);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '加入，記別的組' }));
		await settle();
		s.state.holdRoom = true;
		await fireEvent.click(saveButton());
		first(s);
		localStorage.setItem(localStorageKey, 'en');
		s.releaseRoom();
		await settle();
		return screen.getByRole('alert').textContent!;
	}

	it('中文畫面記的、換成英文才被退回：動作、組寫英文', async () => {
		const bar = await savedAfter((s) => s.recordAs('c1', wang.email, [squad2('twang0000002x')]));
		expect(bar).toContain('Stunt·Lib');
		expect(bar).toContain('Stunt group 2');
		expect(bar).not.toContain('第 2 組');
		expect(bar).not.toContain('技巧');
	});

	it('存起來的那一列照樣有寫好的字（還沒更新的分頁讀得懂），代號另外放', async () => {
		const page = { session: null as unknown as { droppedRecords: { action: unknown; who: unknown; note?: unknown }[] } };
		await savedAfter((s) => {
			page.session = s.page.session as never;
			s.recordAs('c1', wang.email, [squad2('twang0000002x')]);
		});
		const [row] = page.session.droppedRecords;
		expect([row.action, row.who, row.note]).toEqual(['技巧·Lib', '第 2 組 小芳', expect.any(String)]);
	});

	it('先記的人沒有名字（從流程檔傳上來的）：英文寫 Someone else，不寫「別人」', async () => {
		const bar = await savedAfter((s) => (s.state.flows[0].records ??= []).push(squad2('tfile0000002x')));
		expect(bar).toContain('Someone else already recorded Stunt group 2 in this full out');
		expect(bar).not.toContain('別人');
	});
});
