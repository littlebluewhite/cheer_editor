// 程式一開始（hooks.client.ts，#375）：App 裡換上殼的「問殼」、不註冊 service worker；網頁版照舊註冊。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scenarioShell } from '#lib/scenario-shell.js';

const registerSW = vi.fn();
vi.mock('virtual:pwa-register', () => ({ registerSW }));

beforeEach(() => {
	vi.resetModules();
	registerSW.mockClear();
});
afterEach(() => {
	delete window.__cheerShell;
});

/** 重新跑一次 hooks.client.ts，回傳那一次的 host()。 */
async function start() {
	await import('./hooks.client.js');
	return (await import('#lib/host.js')).host();
}

describe('程式一開始', () => {
	it('網頁版：註冊 service worker，不在 App 裡', async () => {
		const host = await start();
		expect(registerSW).toHaveBeenCalledTimes(1);
		expect(host.shell.inApp).toBe(false);
	});

	it('App：殼塞了東西，換上殼的「問殼」，不註冊 service worker', async () => {
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		window.__cheerShell = fake.bridge;
		const host = await start();
		expect(registerSW).not.toHaveBeenCalled();
		expect(host.shell.inApp).toBe(true);
		fake.done();
	});
});
