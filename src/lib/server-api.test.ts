// 連伺服器的 adapter（真的，fetch、WebSocket 換成假的）：傳上雲端的流程太大（伺服器收 16 MB 以下）；
// 房間連不上時分得出被收回、被刪掉（不一直重連）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORMAT_VERSION, type Flow } from '#lib/core';
import { FLOW_TOO_BIG, ServerUnreachable, httpServer } from '#lib/server-api.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

/** 一支流程：name 是 bytes 個字（英文字，一個字一個 byte）。 */
const flowOfSize = (bytes: number) => ({ formatVersion: FORMAT_VERSION, flow: { name: 'x'.repeat(bytes) } as unknown as Flow });

describe('傳上雲端：流程太大', () => {
	it('超過 16 MB：不送，直接說太大', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const made = await httpServer().uploadFlow(flowOfSize(16 * 1024 * 1024));
		expect(made).toEqual({ message: FLOW_TOO_BIG });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('伺服器回 413（例：算法不一樣）：也說太大，不說連不上', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
		const made = await httpServer().uploadFlow(flowOfSize(10));
		expect(made).toEqual({ message: FLOW_TOO_BIG });
	});
});

describe('房間連不上：被收回、被刪掉', () => {
	/** 連房間的 WebSocket 都被伺服器拒絕（馬上關掉）；回開過幾次。 */
	function refusedRoom(flowStatus: number) {
		let opened = 0;
		class Refused {
			onopen: (() => void) | null = null;
			onmessage: (() => void) | null = null;
			onclose: (() => void) | null = null;
			constructor() {
				opened++;
				queueMicrotask(() => this.onclose?.());
			}
			close() {}
		}
		vi.stubGlobal('WebSocket', Refused);
		vi.stubGlobal('location', { href: 'https://cheer.example/' });
		vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
		vi.stubGlobal('navigator', { onLine: true });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => new Response('{}', { status: url.endsWith('/api/me') ? 200 : flowStatus }))
		);
		return { opened: () => opened };
	}

	for (const [status, kind] of [
		[410, 'deleted'],
		[404, 'revoked']
	] as const) {
		it(`流程 ${status}：說 ${kind}，不再重連`, async () => {
			vi.useFakeTimers();
			const ws = refusedRoom(status);
			const room = httpServer().openRoom('c1');
			const heard: unknown[] = [];
			room.onmessage = (m) => heard.push(m);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(heard).toEqual([{ kind }]);
			expect(ws.opened()).toBe(1);
			vi.useRealTimers();
		});
	}
});

describe('拿一支雲端流程', () => {
	it('被擁有者刪了（410）：跟打不開一樣是 null，不說連不上', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 410 })));
		expect(await httpServer().cloudFlow('c1')).toBeNull();
	});
});

describe('登出', () => {
	it('伺服器回 204：登出了', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
		await expect(httpServer().logout()).resolves.toBeUndefined();
	});

	// 403 是擋 CSRF 的 middleware（server/src/csrf.rs）擋下的：沒走到登出，伺服器上還登入著。
	for (const status of [403, 503]) {
		it(`伺服器回 ${status}：沒登出成，說連不上（畫面別當作登出了）`, async () => {
			vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
			await expect(httpServer().logout()).rejects.toThrow(ServerUnreachable);
		});
	}
});
