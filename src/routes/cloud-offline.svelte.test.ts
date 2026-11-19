// 頁面：雲端流程斷線（#255）。一斷線就不能改：畫面變成檢視模式的樣子，角落「斷線了・連上才能改」，名字旁「⚠ 斷線」；
// 房間自己重連，連上提示「連上了。」、回到斷線前的模式。還沒送到的步連上後再送，被退回的就提示；
// 斷線期間別人的改動連上後補上。還有沒送到的步時按「首頁」先問。
// 伺服器換成測試共用的假伺服器（fakeServer）：disconnect() 斷掉我的房間，reconnect() 連回來。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { editorPage, fromMenu, fakeServer, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 林教練登入，打開他的「測試」（libSample）；王教練是編輯者。 */
async function openCloud() {
	const fake = fakeServer({
		users: [lin, wang],
		signedIn: lin.email,
		flows: [
			{
				id: 'c1',
				owner: lin.email,
				flow: libSample(),
				updatedAt: new Date(2026, 10, 7).toISOString(),
				people: { [wang.email]: 'editor' }
			}
		]
	});
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	return { ...fake, page };
}

/** 流程設定改流程名字。 */
async function rename(name: string) {
	await fromMenu('流程設定');
	await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: name } });
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
}

const title = () => document.querySelector('.topbar .title')!.textContent!;
const badge = () => document.querySelector('.field-host .view-badge')?.textContent ?? '';
const purple = () => document.querySelector('.topbar')!.classList.contains('viewing');
const editButton = () => screen.getByRole('button', { name: '編輯' }) as HTMLButtonElement;

describe('雲端流程斷線', () => {
	it('斷線：檢視模式的樣子和字，改不了；連上：「連上了。」、回到原本的模式', async () => {
		const s = await openCloud();
		expect(purple()).toBe(false);

		s.disconnect();
		await flush();
		expect(s.page.session.viewing).toBe(true);
		expect(purple()).toBe(true);
		expect(badge()).toContain('斷線了・連上才能改');
		expect(title()).toContain('⚠ 斷線');
		expect(title()).not.toContain('✓ 已存');
		expect(editButton().disabled).toBe(true);
		expect(screen.getByRole('status').textContent).toBe('斷線了，連上才能改。還沒送出的步，連上後會再送。');
		s.page.session.ask.send({ name: 'renameFlow', args: ['偷改'] });
		expect(s.page.session.flow!.name).toBe('測試');

		s.reconnect();
		await flush();
		expect(screen.getByRole('status').textContent).toBe('連上了。');
		expect(s.page.session.viewing).toBe(false);
		expect(purple()).toBe(false);
		expect(badge()).toBe('');
		expect(title()).toContain('✓ 已存');
		await rename('全國賽');
		await flush();
		expect(s.state.flows[0].flow.name).toBe('全國賽');
	});

	it('斷線前在檢視模式：連上後還是檢視模式', async () => {
		const s = await openCloud();
		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		s.disconnect();
		await flush();
		s.reconnect();
		await flush();
		expect(s.page.session.viewing).toBe(true);
		expect(editButton().disabled).toBe(false);
		expect(badge()).toContain('檢視模式・只能看');
	});

	it('斷線前送出、還沒收到回答的步：連上後再送，伺服器收了', async () => {
		const s = await openCloud();
		s.state.holdRoom = true;
		await rename('全國賽');
		s.disconnect();
		s.state.holdRoom = false;
		await flush();
		expect(s.state.flows[0].flow.name).toBe('測試');
		expect(s.page.session.flow!.name).toBe('全國賽');
		expect(title()).toContain('⚠ 斷線');

		s.reconnect();
		await flush();
		expect(s.state.flows[0].flow.name).toBe('全國賽');
		expect(s.state.flows[0].step).toBe(1);
		expect(title()).toContain('✓ 已存');
	});

	it('斷線期間別人改了同一個地方：連上後補上別人的改動，我那一步被退回並提示', async () => {
		const s = await openCloud();
		s.state.holdRoom = true;
		await rename('全國賽');
		s.disconnect();
		s.state.holdRoom = false;
		await flush();
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'renameFlow', args: ['區賽'] });
		w.step({ name: 'addSegment', args: ['chant'] });
		await flush();

		s.reconnect();
		await flush();
		expect(screen.getByRole('status').textContent).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.page.session.flow!.name).toBe('區賽');
		expect(s.page.session.flow!.segments).toHaveLength(2);
	});

	it('斷線期間別人改的：連上後補上', async () => {
		const s = await openCloud();
		s.disconnect();
		await flush();
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'addSegment', args: ['chant'] });
		await flush();
		expect(s.page.session.flow!.segments).toHaveLength(1);

		s.reconnect();
		await flush();
		expect(s.page.session.flow!.segments).toHaveLength(2);
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('斷線太久補不上：換成伺服器現在的樣子，還沒送到的步不算並提示', async () => {
		const s = await openCloud();
		s.state.holdRoom = true;
		await rename('全國賽');
		s.disconnect();
		s.state.holdRoom = false;
		await flush();
		// 伺服器上已經是第 3 步，中間的步驟紀錄沒留
		s.state.flows[0].flow = { ...s.state.flows[0].flow, name: '區賽' };
		s.state.flows[0].step = 3;

		s.reconnect();
		await flush();
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
		expect(screen.getByRole('status').textContent).toBe('連上了。換成伺服器現在的樣子，還沒送到的 1 步沒存進去。');
		expect(title()).toContain('✓ 已存');
	});

	it('有沒送到的步時按「首頁」：跳框；留下來還在，離開就回首頁', async () => {
		const s = await openCloud();
		s.state.holdRoom = true;
		await rename('全國賽');
		s.page.session.ask.send({ name: 'addSegment', args: ['chant'] });
		s.disconnect();
		s.state.holdRoom = false;
		await flush();

		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		const box = screen.getByRole('alertdialog');
		expect(box.textContent).toContain('還有 2 步沒送到，離開就不見了');
		// 按鈕照 #255：［留下來］［離開（丟掉 N 步）］
		expect(within(box).getAllByRole('button').map((b) => b.textContent)).toEqual(['留下來', '離開（丟掉 2 步）']);
		await fireEvent.click(screen.getByRole('button', { name: '留下來' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(s.page.session.flow!.name).toBe('全國賽');

		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		await fireEvent.click(screen.getByRole('button', { name: '離開（丟掉 2 步）' }));
		expect(s.page.session.flow).toBeNull();
	});

	it('沒有沒送到的步：按「首頁」直接回首頁（斷線也一樣）', async () => {
		const s = await openCloud();
		s.disconnect();
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(s.page.session.flow).toBeNull();
	});

	it('有沒送到的步時關分頁：讓瀏覽器自己問', async () => {
		const s = await openCloud();
		s.state.holdRoom = true;
		await rename('全國賽');
		s.disconnect();
		await flush();
		const e = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(true);
	});
});
