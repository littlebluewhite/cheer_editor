// 頁面：分享給使用者、權限（#250）。分享對話框（擁有者、不是擁有者看到的）、收回不用確認、離開要確認；
// 首頁「分享給我的」；記錄者、檢視者打開是檢視模式；被收回回首頁的黃條；被降級換成檢視模式。
// 伺服器換成測試共用的假伺服器（fakeServer）：分享、房間照真的規則。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { editorPage, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };
const chen = { email: 'chen@example.com', name: '陳教練', isAdmin: false, password: pw, disabled: true };
const huang = { email: 'huang@example.com', name: '黃教練', isAdmin: true, password: pw };

/** 王教練的「測試」（libSample）；people：分享給誰。 */
const wangsFlow = (people: FakeCloudFlow['people'] = {}): FakeCloudFlow => ({
	id: 'c1',
	owner: wang.email,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	people
});

/** me 登入，首頁有這幾支；回假伺服器和頁面。 */
async function signedIn(me: string, flows: FakeCloudFlow[]) {
	const fake = fakeServer({ users: [lin, wang, chen, huang], signedIn: me, flows });
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	return { ...fake, page };
}

/** 點首頁的「測試」打開。 */
async function openIt() {
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
}

async function openShare() {
	await fireEvent.click(screen.getByRole('button', { name: '分享' }));
	await flush();
	return screen.getByRole('dialog', { name: '分享「測試」' });
}

const rows = (dialog: HTMLElement) =>
	within(within(dialog).getByRole('list', { name: '有權限的人' }))
		.getAllByRole('listitem')
		.map((li) => li.textContent!.replace(/\s+/g, ' ').trim());

describe('分享對話框：擁有者', () => {
	it('最上面 email、權限（預設編輯者）、加入（Enter 也算）；加進來列在名單，看得到 email', async () => {
		await signedIn(wang.email, [wangsFlow()]);
		await openIt();
		const dialog = await openShare();
		expect(rows(dialog)).toEqual(['王 王教練（你） wang@example.com 擁有者']);
		expect((within(dialog).getByLabelText('權限') as HTMLSelectElement).value).toBe('editor');

		const email = within(dialog).getByLabelText('Email');
		await fireEvent.input(email, { target: { value: 'LIN@example.com' } });
		await fireEvent.submit(email.closest('form')!);
		await flush();
		expect(rows(dialog)).toEqual(['王 王教練（你） wang@example.com 擁有者', '林 林教練 lin@example.com 編輯者記錄者檢視者收回']);
		expect((within(dialog).getByLabelText('林教練的權限') as HTMLSelectElement).value).toBe('editor');
	});

	it('加不進去各有一句話：沒帳號、自己、已經在名單、被停用', async () => {
		await signedIn(wang.email, [wangsFlow({ [lin.email]: 'recorder' })]);
		await openIt();
		const dialog = await openShare();
		const email = within(dialog).getByLabelText('Email');
		const add = async (value: string) => {
			await fireEvent.input(email, { target: { value } });
			await fireEvent.click(within(dialog).getByRole('button', { name: '加入' }));
			await flush();
			return within(dialog).getByRole('alert').textContent;
		};
		expect(await add('nobody@example.com')).toBe('這個 email 還沒有帳號，請管理員先加。');
		expect(await add('wang@example.com')).toBe('這是你自己。');
		expect(await add('lin@example.com')).toBe('林教練已經是記錄者了，要改在下面改。');
		expect(await add('chen@example.com')).toBe('陳教練的帳號被停用了，不能分享給他。');
	});

	it('改權限；收回不用確認，提示「收回了{名字}的權限。」', async () => {
		const s = await signedIn(wang.email, [wangsFlow({ [lin.email]: 'editor' })]);
		await openIt();
		const dialog = await openShare();

		await fireEvent.change(within(dialog).getByLabelText('林教練的權限'), { target: { value: 'viewer' } });
		await flush();
		expect(s.state.flows[0].people).toEqual({ [lin.email]: 'viewer' });

		await fireEvent.change(within(dialog).getByLabelText('林教練的權限'), { target: { value: 'revoke' } });
		await flush();
		expect(s.state.flows[0].people).toEqual({});
		expect(within(dialog).getByRole('status').textContent).toBe('收回了林教練的權限。');
		expect(rows(dialog)).toEqual(['王 王教練（你） wang@example.com 擁有者']);
		expect(within(dialog).queryByRole('button', { name: '離開這支流程' })).toBeNull();

		await fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

describe('分享對話框：不是擁有者', () => {
	it('只看得到名字、權限（沒有 email、沒有加入、不能改）；離開要確認，離開後回首頁、清單沒有它', async () => {
		const s = await signedIn(lin.email, [wangsFlow({ [lin.email]: 'editor', [chen.email]: 'viewer' })]);
		await openIt();
		const dialog = await openShare();
		expect(rows(dialog)).toEqual(['王 王教練 擁有者', '林 林教練（你） 編輯者', '陳 陳教練已停用 檢視者']);
		expect(within(dialog).queryByLabelText('Email')).toBeNull();
		expect(within(dialog).queryByRole('combobox')).toBeNull();

		// 要確認：取消就不離開
		await fireEvent.click(within(dialog).getByRole('button', { name: '離開這支流程' }));
		const ask = within(dialog).getByRole('alertdialog');
		expect(ask.textContent).toContain('離開「測試」？它不會再出現在「分享給我的」，要擁有者再分享給你才能打開。');
		await fireEvent.click(within(ask).getByRole('button', { name: '取消' }));
		expect(s.state.flows[0].people).toHaveProperty(lin.email);

		await fireEvent.click(within(dialog).getByRole('button', { name: '離開這支流程' }));
		await fireEvent.click(within(dialog).getByRole('button', { name: '離開' }));
		await flush();
		await flush();
		expect(s.state.flows[0].people).not.toHaveProperty(lin.email);
		expect(s.page.session.flow).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByRole('list', { name: '分享給我的' }).textContent).not.toContain('測試');
	});
});

describe('首頁「分享給我的」', () => {
	it('別人的寫「王教練的・編輯者」；擁有者被停用寫「陳教練的（已停用）」', async () => {
		await signedIn(lin.email, [
			wangsFlow({ [lin.email]: 'editor' }),
			{ id: 'c2', owner: chen.email, flow: { ...libSample(), name: '校慶表演' }, updatedAt: new Date(2026, 10, 5, 9, 3).toISOString(), people: { [lin.email]: 'viewer' } }
		]);
		const shared = screen.getByRole('list', { name: '分享給我的' });
		expect([...shared.querySelectorAll('li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'測試 王教練的・編輯者・11/6 15:20 改過',
			'校慶表演 陳教練的（已停用）・11/5 09:03 改過'
		]);
		expect(screen.getByRole('list', { name: '我的流程' }).textContent).not.toContain('測試');
	});
});

describe('權限和檢視模式', () => {
	it('記錄者、檢視者打開一律是檢視模式，「編輯」按不了，改不動', async () => {
		for (const role of ['recorder', 'viewer'] as const) {
			const s = await signedIn(lin.email, [wangsFlow({ [lin.email]: role })]);
			await openIt();
			expect(s.page.session.viewing).toBe(true);
			expect((screen.getByRole('button', { name: '編輯' }) as HTMLButtonElement).disabled).toBe(true);
			s.page.session.ask.send({ name: 'renameFlow', args: ['偷改'] });
			await flush();
			expect(s.state.flows[0].flow.name).toBe('測試');
			document.body.innerHTML = '';
		}
	});

	it('開著時被降成檢視者：馬上換檢視模式，還沒送到的步不算並提示', async () => {
		const s = await signedIn(lin.email, [wangsFlow({ [lin.email]: 'editor' })]);
		await openIt();
		expect(s.page.session.viewing).toBe(false);
		// 一次送一步：A 送出去了，B 排在後面還沒送
		s.state.holdRoom = true;
		s.page.session.ask.send({ name: 'renameFlow', args: ['A'] });
		s.page.session.ask.send({ name: 'renameFlow', args: ['B'] });
		await flush();
		expect(s.page.session.flow!.name).toBe('B');

		s.changeRole('c1', lin.email, 'viewer');
		s.releaseRoom();
		await flush();
		expect(s.page.session.viewing).toBe(true);
		expect((screen.getByRole('button', { name: '編輯' }) as HTMLButtonElement).disabled).toBe(true);
		expect(s.page.session.flow!.name).toBe('A');
		expect(s.page.session.notice).toBe('你現在是檢視者，只能看。還沒送到的 1 步沒存進去。');
		expect(s.state.flows[0].flow.name).toBe('A');
	});

	it('開著時被收回：回首頁，最上面黃的「你已經不能打開「測試」。」，按 × 關掉', async () => {
		const s = await signedIn(lin.email, [wangsFlow({ [lin.email]: 'editor' })]);
		await openIt();
		s.changeRole('c1', lin.email, null);
		await flush();
		await flush();
		expect(s.page.session.flow).toBeNull();
		expect(screen.getByRole('alert').textContent).toContain('你已經不能打開「測試」。');
		expect(screen.getByRole('list', { name: '分享給我的' }).textContent).not.toContain('測試');

		await fireEvent.click(screen.getByRole('button', { name: '關掉這條' }));
		expect(screen.queryByRole('alert')).toBeNull();
	});
});
