// 連伺服器的 adapter（真的，fetch、WebSocket 換成假的）：傳上雲端的流程太大（伺服器收 16 MB 以下）；
// 房間連不上時分得出被收回、被刪掉（不一直重連）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORMAT_VERSION, type Flow } from '#lib/core';
import { ServerUnreachable, httpServer } from '#lib/server-api.js';
import { m } from '#lib/paraglide/messages.js';
import { fakeNetwork } from '#lib/test-fakes.js';

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
		expect(made).toEqual({ message: m.share_flow_too_big() });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('伺服器回 413（例：算法不一樣）：也說太大，不說連不上', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
		const made = await httpServer().uploadFlow(flowOfSize(10));
		expect(made).toEqual({ message: m.share_flow_too_big() });
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
			const room = httpServer('', fakeNetwork().network).openRoom('c1');
			const heard: unknown[] = [];
			room.onmessage = (m) => heard.push(m);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(heard).toEqual([{ kind }]);
			expect(ws.opened()).toBe(1);
			vi.useRealTimers();
		});
	}
});

describe('房間問網路 adapter：有沒有網路', () => {
	/** 連得上的 WebSocket（連上就 open）；回開過的每一個。fetch 照 me 給（丟錯就是連不上）。 */
	function openRoom(me: () => Promise<Response>) {
		const sockets: Socket[] = [];
		class Socket {
			static OPEN = 1;
			readyState = 0;
			onopen: (() => void) | null = null;
			onmessage: (() => void) | null = null;
			onclose: (() => void) | null = null;
			constructor() {
				sockets.push(this);
				queueMicrotask(() => {
					this.readyState = 1;
					this.onopen?.();
				});
			}
			send() {}
			close() {
				this.readyState = 3;
				queueMicrotask(() => this.onclose?.());
			}
		}
		vi.stubGlobal('WebSocket', Socket);
		vi.stubGlobal('location', { href: 'https://cheer.example/' });
		vi.stubGlobal('fetch', vi.fn(me));
		const net = fakeNetwork();
		const room = httpServer('', net.network).openRoom('c1');
		const heard: [boolean, string?][] = [];
		room.onconnection = (connected, why) => heard.push(why ? [connected, why] : [connected]);
		return { net, room, heard, sockets };
	}

	it('網路 adapter 說斷網：自己關掉房間，原因是斷網（不問伺服器）', async () => {
		vi.useFakeTimers();
		const fetch = vi.fn(async () => new Response('{}'));
		const s = openRoom(fetch);
		await vi.advanceTimersByTimeAsync(0);
		s.net.set(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(s.heard).toEqual([[false, 'offline']]);
		expect(fetch).not.toHaveBeenCalled();
		s.room.close();
		vi.useRealTimers();
	});

	it('斷網時連上網路：馬上再連，不等重連的時間', async () => {
		vi.useFakeTimers();
		const s = openRoom(async () => new Response('{}'));
		await vi.advanceTimersByTimeAsync(0);
		s.net.set(false);
		await vi.advanceTimersByTimeAsync(0);
		s.net.set(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(s.sockets).toHaveLength(2);
		expect(s.heard).toEqual([[false, 'offline'], [true]]);
		s.room.close();
		vi.useRealTimers();
	});

	it('網路 adapter 說有網路、伺服器問不到：原因是伺服器沒回應', async () => {
		vi.useFakeTimers();
		const s = openRoom(async () => {
			throw new TypeError('failed');
		});
		await vi.advanceTimersByTimeAsync(0);
		s.sockets[0].close();
		await vi.advanceTimersByTimeAsync(0);
		expect(s.heard).toEqual([[false, 'unreachable']]);
		s.room.close();
		vi.useRealTimers();
	});

	it('關掉房間之後：網路換了也不再連', async () => {
		vi.useFakeTimers();
		const s = openRoom(async () => new Response('{}'));
		await vi.advanceTimersByTimeAsync(0);
		s.room.close();
		s.net.set(false);
		s.net.set(true);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(s.sockets).toHaveLength(1);
		vi.useRealTimers();
	});
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
