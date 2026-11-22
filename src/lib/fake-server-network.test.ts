// 假伺服器的「換網路」帶著測試的網路 adapter 一起換（#355）：測試換網路只叫 network() 一個開關，
// 瀏覽器那一邊（編輯器 module 的 online）說的跟真的一樣。
import { describe, expect, it } from 'vitest';
import { fakeServer, testEditor } from '#lib/test-fakes.js';

describe('假伺服器換網路：瀏覽器那一邊', () => {
	for (const [status, online] of [
		['offline', false],
		['unreachable', true],
		['expired', true]
	] as const) {
		it(`${status}：瀏覽器說${online ? '有' : '沒'}網路`, () => {
			const fake = fakeServer();
			const { editor } = testEditor(null, { server: fake.server });
			fake.network('offline');
			fake.network(status);
			expect(editor.online).toBe(online);
		});
	}

	it('online（斷網後又連上）：瀏覽器說有網路', () => {
		const fake = fakeServer();
		const { editor } = testEditor(null, { server: fake.server });
		fake.network('offline');
		fake.network('online');
		expect(editor.online).toBe(true);
	});
});
