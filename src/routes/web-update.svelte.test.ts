// 頁面（App）：殼下載好新網頁（webBundleReady）不馬上換，教練回到首頁才請殼換上（#393、ADR 0025）。
// 殼照共用情境檔演（bridge-scenarios/current/web-update.json），殼的測試跑同一份。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { appShell } from '#lib/app-shell.js';
import { playScenario, scenario, scenarioShell } from '#lib/scenario-shell.js';
import { editorPage, fakeDraftStore, fakeHost, flush, menuItem } from '#lib/test-fakes.js';
import { SETTLE_MS } from '#lib/web-update.js';
import Page from './+page.svelte';

const settle = () => new Promise((ok) => setTimeout(ok, SETTLE_MS + 50));

async function newFlow() {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
	await flush();
}

function setup(fake: ReturnType<typeof playScenario>) {
	fakeHost({ shell: appShell(fake.bridge) });
	render(Page, editorPage(null, { draftStore: fakeDraftStore().store }).props);
}

describe('App：殼自己更新網頁', () => {
	beforeEach(() => sessionStorage.clear());

	it('編流程時新網頁下載好了：回到首頁才請殼換上', async () => {
		const fake = scenarioShell('web-update.json', '新網頁下載好了，回到首頁時請殼換上');
		setup(fake);
		await flush();
		await newFlow();
		fake.say();
		await settle();
		expect(() => fake.done(), '還在編，不換').toThrow();
		await fireEvent.click((await menuItem('新建'))!);
		await flush();
		await settle();
		fake.done();
	});

	it('新網頁下載好時就在首頁：不換（下次回首頁或下次打開 App 才換）', async () => {
		const { boot, steps } = scenario('web-update.json', '新網頁下載好了，回到首頁時請殼換上');
		const fake = playScenario({ name: '只有下載好了', boot, steps: steps.slice(0, 1) });
		setup(fake);
		await flush();
		fake.say();
		await settle();
		fake.done();
	});

	it('新網頁在帳號頁時下載好了：回到首頁照樣請殼換上', async () => {
		const fake = scenarioShell('web-update.json', '新網頁下載好了，回到首頁時請殼換上');
		fakeHost({ shell: appShell(fake.bridge) });
		const props = editorPage(null, { draftStore: fakeDraftStore().store }).props;
		const home = render(Page, props);
		await flush();
		home.unmount();
		fake.say();
		render(Page, props);
		await flush();
		await settle();
		fake.done();
	});

	it('新網頁在帳號頁時下載好了，整頁重新載入才回到首頁（登出、刪帳號、App 裡的使用說明）：照樣請殼換上', async () => {
		const fake = scenarioShell('web-update.json', '新網頁下載好了，回到首頁時請殼換上');
		fakeHost({ shell: appShell(fake.bridge) });
		const props = editorPage(null, { draftStore: fakeDraftStore().store }).props;
		const home = render(Page, props);
		await flush();
		home.unmount();
		fake.say();
		// 重新載入：網頁裡記著的都沒了，殼換一個新的（殼本身不變）
		fakeHost({ shell: appShell(fake.bridge) });
		render(Page, props);
		await flush();
		await settle();
		fake.done();
	});

	it('殼不會（舊殼）：殼說了也不換', async () => {
		const { steps } = scenario('web-update.json', '新網頁下載好了，回到首頁時請殼換上');
		const fake = playScenario({
			name: '舊殼',
			boot: { shellVersion: '0.1.0', shellBuild: 1, features: [] },
			steps: steps.slice(0, 1)
		});
		setup(fake);
		await flush();
		await newFlow();
		fake.say();
		await fireEvent.click((await menuItem('新建'))!);
		await flush();
		await settle();
		fake.done();
	});
});
