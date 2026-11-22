// App 裡雲端流程的連線（#381）：網頁不自己開 WebSocket，連線由殼開（情境 bridge-scenarios/current/cloudRoom.json，殼的測試在 ios/）。
// 切到背景殼關掉連線，網頁不問為什麼、不自己重連；回到前景馬上重連。網頁版照舊用 WebSocket，切分頁不斷線。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { httpServer, type FlowRoom } from '#lib/server-api.js';
import { flush } from '#lib/test-fakes.js';

afterEach(() => {
	delete window.__cheerShell;
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** 照情境演的殼接上（跟 App 一開始一樣走 useShellIfInApp）；問伺服器（fetch）的都記下來。 */
function inApp(name: string) {
	const fake = scenarioShell('cloudRoom.json', name);
	window.__cheerShell = fake.bridge;
	const undo = useShellIfInApp();
	const fetch = vi.fn(async () => new Response('{}'));
	vi.stubGlobal('fetch', fetch);
	return { fake, fetch, undo: () => undo?.() };
}

/** 房間說的話、連線的變化。 */
function listen(room: FlowRoom) {
	const heard: unknown[] = [];
	const links: unknown[] = [];
	room.onmessage = (m) => heard.push(m);
	room.onconnection = (connected, why) => links.push(why ? [connected, why] : connected);
	return { heard, links };
}

describe('App 裡', () => {
	it('雲端流程的連線由殼開：送、收、關都經過殼', async () => {
		const { fake, undo } = inApp('雲端流程的連線由殼開');
		try {
			const room = httpServer().openRoom('c1');
			const { heard } = listen(room);
			await flush();
			// 還沒連上時送的先排著，連上就送
			room.send({ kind: 'mode', editing: true });
			fake.say();
			await flush();
			fake.say();
			expect(heard).toEqual([{ kind: 'ready' }]);
			room.close();
			await flush();
			fake.done();
		} finally {
			undo();
		}
	});

	it('切到背景：殼關掉連線，網頁不能改，不問伺服器為什麼、不自己重連', async () => {
		vi.useFakeTimers();
		const { fake, fetch, undo } = inApp('切到背景');
		try {
			const room = httpServer().openRoom('c1');
			const { links } = listen(room);
			await vi.advanceTimersByTimeAsync(0);
			fake.say();
			fake.say();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(links).toEqual([[false, 'offline']]);
			expect(fetch).not.toHaveBeenCalled();
			fake.done();
			room.close();
		} finally {
			undo();
		}
	});

	it('回到前景：馬上重連，連上了才能改', async () => {
		vi.useFakeTimers();
		const { fake, undo } = inApp('回到前景');
		try {
			const room = httpServer().openRoom('c1');
			const { links } = listen(room);
			await vi.advanceTimersByTimeAsync(0);
			fake.say();
			fake.say();
			fake.say();
			await vi.advanceTimersByTimeAsync(0);
			expect(links).toEqual([[false, 'offline']]);
			fake.say();
			expect(links).toEqual([[false, 'offline'], true]);
			fake.done();
			room.close();
		} finally {
			undo();
		}
	});
});

const opened: Socket[] = [];
/** 瀏覽器的 WebSocket（網頁版）：記下開了哪幾條、有沒有關。 */
class Socket {
	static OPEN = 1;
	readyState = 1;
	closed = false;
	onopen: (() => void) | null = null;
	onmessage: (() => void) | null = null;
	onclose: (() => void) | null = null;
	constructor(readonly url: string | URL) {
		opened.push(this);
	}
	send() {}
	close() {
		this.closed = true;
	}
}

describe('網頁版', () => {
	it('照舊用 WebSocket；切到別的分頁、縮小視窗不斷線', () => {
		vi.stubGlobal('WebSocket', Socket);
		const room = httpServer().openRoom('c1');
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('blur'));
		expect(opened.map((s) => [String(s.url), s.closed])).toEqual([[`${location.origin.replace('http', 'ws')}/api/flows/c1/room`, false]]);
		room.close();
		delete (document as { visibilityState?: unknown }).visibilityState;
	});
});
