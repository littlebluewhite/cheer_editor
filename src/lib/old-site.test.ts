// 舊網址版（#267）不碰伺服器：連伺服器的 adapter 不 fetch，當作沒登入、連不上。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpServer, ServerUnreachable } from '#lib/server-api.js';

vi.mock('#lib/old-site.js', async (load) => ({ ...(await load<typeof import('#lib/old-site.js')>()), OLD_SITE: true }));

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('舊網址版：不碰伺服器', () => {
	it('問我是誰：沒登入；登入、分享連結、雲端流程：連不上；都沒有 fetch', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const server = httpServer();
		expect(await server.me()).toBeNull();
		expect(await server.loginExpired()).toBe(false);
		await expect(server.login('lin@example.com', 'x')).rejects.toBeInstanceOf(ServerUnreachable);
		await expect(server.linkedFlow('abc')).rejects.toBeInstanceOf(ServerUnreachable);
		await expect(server.cloudFlow('f1')).rejects.toBeInstanceOf(ServerUnreachable);
		expect(fetch).not.toHaveBeenCalled();
	});
});
