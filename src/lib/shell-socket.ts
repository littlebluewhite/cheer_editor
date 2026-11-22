// App 裡雲端流程的連線（#381，#304 的結論）：App 裡的網頁不自己開 WebSocket（app://local 連不上、帶不到登入 cookie），
// 殼開連線、帶殼自己的 cookie（ios/ShellCore/Sources/ShellCore/Parts/CloudRoomPart.swift）。這裡給一個跟 WebSocket 一樣的介面，
// 房間（server-api.ts 的 openRoom）照樣用。說的話寫在 bridge-scenarios/current/cloudRoom.json。
import type { Shell } from '#lib/host.js';

/** 殼會開雲端流程的連線（「問殼」的名字）。 */
export const CLOUD_ROOM_FEATURE = 'cloudRoom';

/** App 切到背景、鎖螢幕，殼關掉的連線：關的時候帶這個代號（WebSocket 自己用的 4000–4999）。 */
export const ASLEEP_CODE = 4000;

/** 房間用到的 WebSocket 那幾樣（瀏覽器的 WebSocket、殼開的 shellSocket 都是）。 */
export interface RoomSocket {
	readonly readyState: number;
	send(text: string): void;
	close(): void;
	onopen: ((e: Event) => void) | null;
	onmessage: ((e: MessageEvent) => void) | null;
	onclose: ((e: CloseEvent) => void) | null;
}

const OPEN = 1;
const CLOSED = 3;
/** 每個殼各自數到第幾條（情境裡的 id 是 1、2、3…）。 */
const counts = new WeakMap<Shell, number>();

/** 請殼開一條連線到 url（網站網址底下的 /api/…，別的殼不開）。 */
export function shellSocket(shell: Shell, url: string): RoomSocket {
	const id = (counts.get(shell) ?? 0) + 1;
	counts.set(shell, id);
	const mine = (body: unknown): boolean => (body as { id?: unknown } | null)?.id === id;
	const stops: (() => void)[] = [];
	const done = (code: number) => {
		if (socket.readyState === CLOSED) return;
		socket.readyState = CLOSED;
		for (const stop of stops.splice(0)) stop();
		socket.onclose?.({ code } as CloseEvent);
	};
	const socket = {
		readyState: 0,
		onopen: null as RoomSocket['onopen'],
		onmessage: null as RoomSocket['onmessage'],
		onclose: null as RoomSocket['onclose'],
		send(text: string) {
			if (socket.readyState === OPEN) void shell.send('socketSend', { id, text }).catch(() => {});
		},
		close() {
			if (socket.readyState === CLOSED) return;
			void shell.send('socketClose', { id }).catch(() => {});
			queueMicrotask(() => done(1000));
		}
	};
	stops.push(
		shell.on('socketOpened', (body) => {
			if (!mine(body) || socket.readyState !== 0) return;
			socket.readyState = OPEN;
			socket.onopen?.({} as Event);
		}),
		shell.on('socketMessage', (body) => {
			if (mine(body) && socket.readyState === OPEN) socket.onmessage?.({ data: (body as { text: string }).text } as MessageEvent);
		}),
		shell.on('socketClosed', (body) => {
			if (mine(body)) done((body as { background?: boolean }).background ? ASLEEP_CODE : 1006);
		})
	);
	// 殼開不了（網址不對、殼出錯）：當成斷線
	void shell.send('socketOpen', { id, url }).catch(() => done(1006));
	return socket;
}
