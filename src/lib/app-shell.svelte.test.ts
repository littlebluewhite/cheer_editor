// 網頁和殼之間的第一句話（#375）：殼在 document start 塞「在 App 裡、殼的版本、會什麼」，網頁用「問殼」讀；
// 網頁畫面出來以後跟殼說「好了」。殼用照情境檔演的假殼（#lib/scenario-shell.js），殼的測試跑同一份。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { browserHost, host } from '#lib/host.js';
import { appShell, useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { fakeHost, flush } from '#lib/test-fakes.js';
import Layout from '../routes/+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>內容</p>' }));

afterEach(() => {
	cleanup();
	delete window.__cheerShell;
});

describe('在不在 App 裡', () => {
	it('網頁版：沒有殼塞的東西，照舊答不在', () => {
		expect(useShellIfInApp()).toBeUndefined();
		expect(host().shell.inApp).toBe(false);
	});

	it('App：殼一開始塞了，「問殼」答在，會什麼照殼說的', () => {
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		window.__cheerShell = { ...fake.bridge, boot: { ...fake.bridge.boot, features: ['print'] } };
		const undo = useShellIfInApp();
		expect(undo).toBeTypeOf('function');
		try {
			expect(host().shell.inApp).toBe(true);
			expect(host().shell.can('print')).toBe(true);
			expect(host().shell.can('nowPlaying')).toBe(false);
		} finally {
			undo?.();
		}
		expect(host().shell.inApp).toBe(false);
		fake.done();
	});

	it('App：照情境，殼會的事一件都沒有', () => {
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		const shell = appShell(fake.bridge);
		expect(shell.inApp).toBe(true);
		expect(shell.can('print')).toBe(false);
		fake.done();
	});

	it('殼不認得的話：網頁收到錯誤，不會一直等', async () => {
		const fake = scenarioShell('shell.json', '殼不認得的話回錯誤');
		await expect(appShell(fake.bridge).send('noSuchThing', { any: 1 })).rejects.toThrow('unknown');
		fake.done();
	});
});

describe('好了', () => {
	it('App：網頁畫面出來以後跟殼說好了', async () => {
		const fake = scenarioShell('ready.json', '網頁畫面出來以後跟殼說好了');
		fakeHost({ shell: appShell(fake.bridge) });
		render(Layout, { children });
		await flush();
		fake.done();
	});

	it('網頁版：不跟誰說', async () => {
		const send = vi.fn(browserHost.shell.send);
		fakeHost({ shell: { ...browserHost.shell, send } });
		render(Layout, { children });
		await flush();
		expect(send).not.toHaveBeenCalled();
	});
});
