// 頁面：即時看到別人的改動、誰開著（#253）。別人收了的一步套在畫面上，開著的表單不關；在改的東西被刪了才關掉並說原因；
// 選著的被刪了不再選著。「分享」左邊是別人的頭像（自己不列）。同一個人開第二個分頁也打得開。
// 伺服器換成測試共用的假伺服器（fakeServer）：別人用 joinAs 在別的地方打開、送步。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { editorPage, fakeServer, fakeTabs, flush, testEditor } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };
const chen = { email: 'chen@example.com', name: '陳教練', isAdmin: false, password: pw };

/** 林教練登入，打開他的「測試」（libSample）；王教練是編輯者、陳教練是檢視者。 */
async function linOpens() {
	const fake = fakeServer({
		users: [lin, wang, chen],
		signedIn: lin.email,
		flows: [
			{
				id: 'c1',
				owner: lin.email,
				flow: libSample(),
				updatedAt: new Date(2026, 10, 7).toISOString(),
				people: { [wang.email]: 'editor', [chen.email]: 'viewer' }
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

const title = () => document.querySelector('.topbar .title')!.textContent!;
const faces = () => within(screen.getByRole('list', { name: '誰開著' })).queryAllByRole('listitem');

describe('別人的改動', () => {
	it('收到別人的改動：畫面跟著變，跟伺服器一樣', async () => {
		const s = await linOpens();
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'renameFlow', args: ['全國賽'] }, { name: 'setPositions', args: ['f1', { m1: [1, 1] }] });
		await flush();

		expect(title()).toContain('全國賽');
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
		expect(title()).toContain('✓ 已存');
	});

	it('開著的表單還在（流程設定、在改的動作）', async () => {
		const s = await linOpens();
		s.page.session.selectAction('x1');
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'renameFlow', args: ['全國賽'] }, { name: 'updateAction', args: ['x1', { note: '注意手' }] });
		await flush();

		expect(s.page.session.flow!.name).toBe('全國賽');
		expect(screen.getByRole('dialog', { name: /流程設定/ })).toBeTruthy();
		expect(s.page.session.selectedActionId).toBe('x1');
		expect(s.page.session.notice).toBe('');
	});

	it('在改的動作被別人刪了：表單回到新增，說原因', async () => {
		const s = await linOpens();
		s.page.session.selectAction('x1');
		await flush();
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'deleteAction', args: ['x1', { confirmed: true }] });
		await flush();

		expect(s.page.session.selectedActionId).toBeNull();
		expect(s.page.editor.actionDraft.action).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('王教練刪掉了你在改的動作「技巧·Lib」');
	});

	it('開著的段設定那一段被別人刪了：段設定關掉，說原因', async () => {
		const s = await linOpens();
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		expect(screen.getByRole('dialog', { name: '音樂 1 設定' })).toBeTruthy();
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'deleteSegment', args: ['s1', { confirmed: true }] });
		await flush();

		expect(screen.queryByRole('dialog', { name: '音樂 1 設定' })).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('王教練刪掉了你在改的段');
	});

	it('選著的人被別人刪了：不再選著，不說什麼', async () => {
		const s = await linOpens();
		s.page.session.selectMembers(['m3', 'm4']);
		const w = s.joinAs('c1', wang.email);
		await flush();
		w.step({ name: 'deleteMember', args: ['m4', { confirmed: true }] });
		await flush();

		expect(s.page.session.selectedMemberIds).toEqual(['m3']);
		expect(s.page.session.flow!.members.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
		expect(s.page.session.notice).toBe('');
	});

	it('檢視者也即時看到', async () => {
		const fake = fakeServer({
			users: [lin, wang],
			signedIn: wang.email,
			flows: [
				{
					id: 'c1',
					owner: lin.email,
					flow: libSample(),
					updatedAt: new Date(2026, 10, 7).toISOString(),
					people: { [wang.email]: 'viewer' }
				}
			]
		});
		const page = editorPage(null, { server: fake.server });
		render(Page, page.props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
		await flush();
		fake.joinAs('c1', lin.email).step({ name: 'renameFlow', args: ['全國賽'] });
		await flush();

		expect(page.session.viewing).toBe(true);
		expect(title()).toContain('全國賽');
	});
});

describe('誰開著', () => {
	it('別人的頭像在「分享」左邊：名字第一個字、一人一個顏色、在編輯（筆）還是檢視（眼睛），滑過去寫誰在做什麼；自己不列', async () => {
		const s = await linOpens();
		expect(screen.queryByRole('list', { name: '誰開著' })).toBeNull();

		s.joinAs('c1', wang.email, true);
		s.joinAs('c1', chen.email, true);
		await flush();
		const [w, c] = faces();
		expect(faces()).toHaveLength(2);
		expect(w.textContent!.trim()).toBe('王');
		expect(w.getAttribute('title')).toBe('王教練・編輯中');
		expect(w.querySelector('.present-mode svg')).toBeTruthy();
		// 陳教練是檢視者：說要編輯也是檢視
		expect(c.getAttribute('title')).toBe('陳教練・檢視中');
		expect(w.style.getPropertyValue('--face')).not.toBe(c.style.getPropertyValue('--face'));
		expect(w.querySelector('.present-mode')!.innerHTML).not.toBe(c.querySelector('.present-mode')!.innerHTML);
		// 「分享」在頭像右邊
		const share = screen.getByRole('button', { name: '分享' });
		expect(screen.getByRole('list', { name: '誰開著' }).compareDocumentPosition(share)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('別人換成檢視、離開，頭像跟著變', async () => {
		const s = await linOpens();
		const w = s.joinAs('c1', wang.email, true);
		await flush();
		w.mode(false);
		await flush();
		expect(faces()[0].getAttribute('title')).toBe('王教練・檢視中');

		w.room.close();
		await flush();
		expect(screen.queryByRole('list', { name: '誰開著' })).toBeNull();
	});

	it('我換成檢視模式：告訴伺服器，別人看到我「檢視中」', async () => {
		const s = await linOpens();
		const w = s.joinAs('c1', wang.email, true);
		await flush();
		const said = () => w.heard.filter((m) => m.kind === 'present').at(-1);
		expect(said()).toEqual({ kind: 'present', people: [{ userId: 1, name: '林教練', editing: true }] });

		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		await flush();
		expect(said()).toEqual({ kind: 'present', people: [{ userId: 1, name: '林教練', editing: false }] });
	});
});

describe('同一個人開兩個分頁', () => {
	it('第二個分頁打開同一支雲端流程不會被擋', async () => {
		const tabs = fakeTabs();
		const s = await (async () => {
			const fake = fakeServer({
				users: [lin],
				signedIn: lin.email,
				flows: [{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: new Date(2026, 10, 7).toISOString() }]
			});
			const page = editorPage(null, { server: fake.server, openTabChannel: tabs });
			render(Page, page.props);
			await flush();
			await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
			await flush();
			return { ...fake, page };
		})();
		expect(s.page.editor.file.cloudId).toBe('c1');

		const second = testEditor(null, { server: s.server, openTabChannel: tabs });
		const stop = second.editor.file.connect();
		await second.editor.file.openCloud('c1');
		await flush();
		expect(second.editor.file.openError).toBe('');
		expect(second.session.flow!.name).toBe('測試');
		stop();
	});
});
