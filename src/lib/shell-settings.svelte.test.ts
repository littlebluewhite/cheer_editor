// 小設定存在殼裡（#378）：App 裡的小設定一開始就從殼塞的那份同步讀，改了馬上寫回殼。
// 殼用照情境檔演的假殼（bridge-scenarios/current/settings.json），殼的測試跑同一份。
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { getLocale, setLocale } from '#lib/paraglide/runtime.js';
import { host } from '#lib/host.js';
import { useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { loadLegendOpen, loadReturnOnStop, saveLegendOpen } from '#lib/local-settings.js';
import { flush } from '#lib/test-fakes.js';
import Guide from '../routes/guide/+page.svelte';

afterEach(() => {
	cleanup();
	delete window.__cheerShell;
	localStorage.clear();
});

/** 照情境換上殼（跟 App 一開始一樣），這個測試跑完換回網頁版。 */
function inApp(name: string) {
	const fake = scenarioShell('settings.json', name);
	window.__cheerShell = fake.bridge;
	const undo = useShellIfInApp();
	onTestFinished(() => undo?.());
	return fake;
}

describe('App 裡的小設定', () => {
	it('一開始就讀得到殼存著的（不用等），不讀網頁的 localStorage', () => {
		localStorage.setItem('cheer-editor:returnOnStop', '1');
		const fake = inApp('一開始塞存著的小設定和上次那支');
		expect(loadReturnOnStop()).toBe(false);
		expect(host().settings.get('cheer-editor:lastFlow')).toBe('f3-abc');
		fake.done();
	});

	it('改了馬上寫回殼，這次也讀得到改過的', async () => {
		const fake = inApp('改了馬上寫回殼');
		saveLegendOpen(false);
		host().settings.remove('cheer-editor:returnOnStop');
		await flush();
		expect(loadLegendOpen()).toBe(false);
		expect(loadReturnOnStop()).toBe(true);
		expect(Object.keys(localStorage).filter((k) => k.startsWith('cheer-editor:'))).toEqual([]);
		fake.done();
	});
});

describe('留在網頁裡的', () => {
	it('App 裡換語言、使用說明打勾：照舊存在網頁的 localStorage，不跟殼說', async () => {
		const fake = inApp('一開始塞存著的小設定和上次那支');
		const before = getLocale();
		onTestFinished(() => setLocale(before, { reload: false }));
		setLocale('en', { reload: false });
		expect(localStorage.getItem('PARAGLIDE_LOCALE')).toBe('en');
		setLocale(before, { reload: false });
		render(Guide);
		await fireEvent.click(screen.getAllByRole('checkbox')[0]);
		expect(localStorage.getItem('cheer-editor:guideTrialDone')).toBe('[true]');
		await flush();
		fake.done();
	});
});
