// 列印的接口（#366、#391）：網頁版用瀏覽器列印；App 裡請殼印（情境 bridge-scenarios/current/print.json），iPad 上列印畫面從按的那顆鈕跳出來。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appShell } from '#lib/app-shell.js';
import { printPage } from '#lib/print.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { fakeHost, flush } from '#lib/test-fakes.js';

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

/** 一顆在畫面上 (10, 20)、80×32 的「列印」鈕，按下去叫 printPage。 */
function printButton() {
	const button = document.createElement('button');
	button.getBoundingClientRect = () => new DOMRect(10, 20, 80, 32);
	button.addEventListener('click', printPage);
	document.body.append(button);
	return button;
}

describe('列印', () => {
	it('網頁版：叫瀏覽器列印', () => {
		const print = vi.spyOn(window, 'print').mockImplementation(() => {});
		printButton().click();
		expect(print).toHaveBeenCalledOnce();
	});

	it('App 裡：請殼印，說按鈕在哪；不叫瀏覽器列印', async () => {
		const print = vi.spyOn(window, 'print').mockImplementation(() => {});
		const fake = scenarioShell('print.json', '按列印請殼印，說按鈕在哪');
		fakeHost({ shell: appShell(fake.bridge) });
		printButton().click();
		await flush();
		fake.done();
		expect(print).not.toHaveBeenCalled();
	});

	it('App 裡：不是按鈕叫的，就不說位置', async () => {
		const fake = scenarioShell('print.json', '沒說按鈕在哪也印');
		fakeHost({ shell: appShell(fake.bridge) });
		printPage();
		await flush();
		fake.done();
	});

	it('殼不會印（舊殼）：照舊叫瀏覽器列印', () => {
		const print = vi.spyOn(window, 'print').mockImplementation(() => {});
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		fakeHost({ shell: appShell(fake.bridge) });
		printButton().click();
		expect(print).toHaveBeenCalledOnce();
		fake.done();
	});
});
