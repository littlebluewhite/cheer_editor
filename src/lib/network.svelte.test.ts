// 真的網路 adapter（jsdom）：讀瀏覽器的 navigator.onLine，online／offline 事件來了通知，不聽了就不再通知。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserNetwork } from '#lib/network.js';

afterEach(() => vi.restoreAllMocks());

describe('真的網路 adapter', () => {
	it('說的是瀏覽器的旗標；斷網、連上都通知；不聽了就不再通知', () => {
		const network = browserNetwork();
		const flag = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		expect(network.online()).toBe(false);

		const heard: boolean[] = [];
		const stop = network.onChange(() => heard.push(network.online()));
		window.dispatchEvent(new Event('offline'));
		flag.mockReturnValue(true);
		window.dispatchEvent(new Event('online'));
		expect(heard).toEqual([false, true]);

		stop();
		window.dispatchEvent(new Event('offline'));
		expect(heard).toEqual([false, true]);
	});
});
