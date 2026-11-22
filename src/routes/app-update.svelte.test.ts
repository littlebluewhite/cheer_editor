// 頁面（App）：雲端流程被新版擋住時的「更新」（#394，#307 第 2、4 點）。
// 殼照共用情境檔演（bridge-scenarios/current/web-update.json），殼的測試跑同一份；伺服器、離線存放是測試共用的假的。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { appShell } from '#lib/app-shell.js';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { playScenario, scenario, scenarioShell } from '#lib/scenario-shell.js';
import { editorPage, fakeHost, fakeOfflineStore, fakeServer, fakeShell, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };

const linsFlow = (): FakeCloudFlow => ({
	id: 'c1',
	owner: lin.email,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	people: {},
	records: []
});

const settle = async () => {
	for (let i = 0; i < 6; i++) await flush();
};

/** 被擋的伺服器（指紋不一樣）。 */
function blockedServer() {
	const fake = fakeServer({ users: [lin], signedIn: lin.email, flows: [linsFlow()] });
	fake.state.fingerprint = 'newer-core';
	return fake;
}

/** 林教練登入、從首頁打開「測試」。 */
async function open(fake = blockedServer(), offline = fakeOfflineStore()) {
	const page = editorPage(null, { server: fake.server, offline: offline.store });
	const view = render(Page, page.props);
	await settle();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await settle();
	return { ...fake, page, offline, view };
}

/** 檢視模式右上角的那塊（被擋時寫為什麼）。 */
const badge = () => document.querySelector<HTMLElement>('.view-badge')!;
const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
	history.replaceState(null, '', '/');
});

describe('App：雲端流程被擋時的更新', () => {
	it('看得到「有新版」和「更新」；按了請殼馬上換、回到同一支流程', async () => {
		const fake = scenarioShell('web-update.json', '雲端流程被擋：新網頁好了，按更新馬上換、回到同一支流程');
		fakeHost({ shell: appShell(fake.bridge) });
		await open();
		expect(text(badge())).toContain('有新版');
		expect(text(badge())).not.toContain('重新整理');
		await fireEvent.click(within(badge()).getByRole('button', { name: '更新' }));
		await settle();
		fake.done();
	});

	it('想改流程時擋下說的話：請按「更新」，不是重新整理', async () => {
		const { boot, steps } = scenario('web-update.json', '雲端流程被擋：網站上的要比這個殼新的殼，不換');
		fakeHost({ shell: appShell(playScenario({ name: '只問', boot, steps }).bridge) });
		const s = await open();
		expect(s.page.session.readOnly).toBe('有新版，請按「更新」');
	});

	it('網站上的要比這個殼新的殼：寫「這版 App 太舊」，有開 App Store 的按鈕，沒有「更新」', async () => {
		const fake = scenarioShell('web-update.json', '雲端流程被擋：網站上的要比這個殼新的殼，不換');
		fakeHost({ shell: appShell(fake.bridge) });
		await open();
		expect(text(badge())).toContain('這版 App 太舊，請到 App Store 更新');
		expect(within(badge()).getByRole('button', { name: '到 App Store' })).toBeTruthy();
		expect(within(badge()).queryByRole('button', { name: '更新' })).toBeNull();
		fake.done();
	});

	it('新網頁抓不到：按了不換，說還沒抓到', async () => {
		const fake = scenarioShell('web-update.json', '雲端流程被擋：新網頁抓不到，按更新也不換');
		fakeHost({ shell: appShell(fake.bridge) });
		const s = await open();
		await fireEvent.click(within(badge()).getByRole('button', { name: '更新' }));
		await settle();
		expect(s.page.session.notice).toBe('新版還沒抓到，請確認連上網路後再按一次。');
		fake.done();
	});

	it('練習頁的提示條也有「更新」', async () => {
		const { boot, steps } = scenario('web-update.json', '雲端流程被擋：新網頁好了，按更新馬上換、回到同一支流程');
		const fake = playScenario({ name: '練習頁', boot, steps });
		fakeHost({ shell: appShell(fake.bridge) });
		await open();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const bar = document.querySelector<HTMLElement>('.practice .bar')!;
		expect(text(bar)).toContain('有新版：記的先存著，更新後自動傳。');
		await fireEvent.click(within(bar).getByRole('button', { name: '更新' }));
		await settle();
		fake.done();
	});

	it('換完回來（網址 ?cloud=代號）：打開同一支，連得上，被擋時記的自動傳；網址上的代號拿掉', async () => {
		const offline = fakeOfflineStore();
		const fake = blockedServer();
		fakeHost({ shell: fakeShell(['webUpdate']) });
		const s = await open(fake, offline);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const card = within(screen.getByRole('region', { name: '第 1 組 小美' }));
		await fireEvent.click(screen.getByRole('button', { name: '第 1 組 小美 上法 成功' }));
		await fireEvent.click(card.getByRole('button', { name: '存這一次' }));
		await settle();
		s.page.session.open(null);
		s.view.unmount();
		document.body.innerHTML = '';

		// 殼換上新網頁、載入首頁 ?cloud=c1：新網頁的指紋跟伺服器一樣
		fake.state.fingerprint = CORE_FINGERPRINT;
		history.replaceState(null, '', '/?cloud=c1');
		const page = editorPage(null, { server: fake.server, offline: offline.store });
		render(Page, page.props);
		await settle();
		expect(page.editor.file.cloudId).toBe('c1');
		expect(page.editor.file.cloud!.newVersion).toBe(false);
		expect(page.editor.file.cloud!.offline).toBe(false);
		expect((fake.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(location.search).toBe('');
	});
});

describe('不在 App 裡、殼不會：被擋時的字照舊', () => {
	it('網頁版：寫「有新版，請重新整理」，沒有「更新」', async () => {
		const s = await open();
		expect(text(badge())).toContain('有新版，請重新整理');
		expect(within(badge()).queryByRole('button', { name: '更新' })).toBeNull();
		expect(s.page.session.readOnly).toBe('有新版，請重新整理');
	});

	it('網頁版的網址有 ?cloud=：不自己打開', async () => {
		history.replaceState(null, '', '/?cloud=c1');
		const page = editorPage(null, { server: blockedServer().server, offline: fakeOfflineStore().store });
		render(Page, page.props);
		await settle();
		expect(page.editor.file.cloudId).toBeNull();
	});

	it('舊殼（不會 webUpdate）：字照舊，沒有「更新」', async () => {
		fakeHost({ shell: fakeShell([]) });
		await open();
		expect(text(badge())).toContain('有新版，請重新整理');
		expect(within(badge()).queryByRole('button', { name: '更新' })).toBeNull();
	});
});
