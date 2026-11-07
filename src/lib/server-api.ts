// 連伺服器的 adapter：所有 HTTP 呼叫都經過它（ADR 0009：API 跟網頁同一個網址，cookie 由瀏覽器帶）。
// 真的是 httpServer；假的是 #lib/test-fakes.js 的 fakeServer（前端測試不開真的伺服器）。
// 訊息的型別從 Rust 產生（src/lib/api-types/，見 docs/deploy.md），對不上就編譯不過。
import type { NewFlowInput } from '#lib/core';
import type { CloudFlow } from '#lib/api-types/CloudFlow.js';
import type { CloudFlowSummary } from '#lib/api-types/CloudFlowSummary.js';
import type { LinkInfo } from '#lib/api-types/LinkInfo.js';
import type { Me } from '#lib/api-types/Me.js';
import type { MyFlows } from '#lib/api-types/MyFlows.js';
import type { PasswordProblem } from '#lib/api-types/PasswordProblem.js';
import type { Presigned } from '#lib/api-types/Presigned.js';
import type { RoomMessage } from '#lib/api-types/RoomMessage.js';
import type { RoomRequest } from '#lib/api-types/RoomRequest.js';
import type { SignedOut } from '#lib/api-types/SignedOut.js';
import type { StartUpload } from '#lib/api-types/StartUpload.js';
import type { TooManyTries } from '#lib/api-types/TooManyTries.js';
import type { AdminProblem } from '#lib/api-types/AdminProblem.js';
import type { UserRow } from '#lib/api-types/UserRow.js';
import type { UserStatus } from '#lib/api-types/UserStatus.js';

export type {
	AdminProblem,
	CloudFlow,
	CloudFlowSummary,
	LinkInfo,
	Me,
	PasswordProblem,
	RoomMessage,
	RoomRequest,
	TooManyTries,
	UserRow,
	UserStatus
};

/** 一支雲端流程的房間（WebSocket）：送步、收伺服器的回答。還沒連上時送的先排著，連上就送。 */
export interface FlowRoom {
	send(request: RoomRequest): void;
	/** 收到伺服器說的話（房間建好後接上）。 */
	onmessage: (message: RoomMessage) => void;
	close(): void;
}

/** 管理的事的結果：做好了，或做不成的原因（email 撞到別人、今天寄不出去、這個人現在不能這樣做）。 */
export type AdminResult = 'ok' | AdminProblem;

/** 設密碼的結果：設好、連結不能用了（過期、用過、亂改的），或密碼不收的原因。 */
export type SetPasswordResult = 'ok' | 'gone' | PasswordProblem;

/** 改密碼的結果：改好、現在的密碼不對、試太多次（鎖住），或新密碼不收的原因。 */
export type ChangePasswordResult = 'ok' | 'wrong' | TooManyTries | PasswordProblem;

/** 「試太多次了，請 N 秒後再試」：一分鐘以上寫幾分鐘（不滿一分鐘算一分鐘）。 */
export function tooManyTriesText({ retryAfter }: TooManyTries): string {
	const wait = retryAfter < 60 ? `${retryAfter} 秒` : `${Math.ceil(retryAfter / 60)} 分鐘`;
	return `試太多次了，請 ${wait}後再試`;
}

/** 伺服器出錯、連不上（斷網、伺服器沒回應）。 */
export class ServerUnreachable extends Error {
	constructor() {
		super('連不上伺服器');
	}
}

export interface ServerAdapter {
	/** 我是誰；沒登入（或登入超過 30 天、連不上伺服器）是 null。 */
	me(): Promise<Me | null>;
	/** 沒登入是因為登入超過 30 天了（不是沒登入過、不是登出了）。 */
	loginExpired(): Promise<boolean>;
	/** 登入：'wrong' 是 email 或密碼不對（沒這個人、被停用也一樣）；猜錯太多次是要等幾秒。 */
	login(email: string, password: string): Promise<'ok' | 'wrong' | TooManyTries>;
	/** 登出這台裝置。 */
	logout(): Promise<void>;
	/** 打開設密碼連結：是誰的、哪一種；不能用了是 null。不會用掉連結。 */
	passwordLink(token: string): Promise<LinkInfo | null>;
	/** 用設密碼連結設密碼。 */
	setPassword(token: string, password: string): Promise<SetPasswordResult>;

	// 管理使用者：只有管理員能叫（#245）。
	/** 所有使用者；不是管理員是 null。 */
	listUsers(): Promise<UserRow[] | null>;
	/** 加使用者、寄邀請。 */
	addUser(email: string, name: string): Promise<AdminResult>;
	/** 重寄邀請：舊的連結馬上不能用。 */
	resendInvite(id: number): Promise<AdminResult>;
	/** 寄重設密碼信。 */
	sendReset(id: number): Promise<AdminResult>;
	/** 改 email：新舊兩個信箱都收到通知。 */
	changeEmail(id: number, email: string): Promise<AdminResult>;
	/** 停用：他每台裝置登出、還沒用的連結作廢。 */
	disableUser(id: number): Promise<AdminResult>;
	/** 恢復：用原本的密碼就能登入。 */
	enableUser(id: number): Promise<AdminResult>;

	/** 我的流程（我擁有的雲端流程），最近改的在前。 */
	myFlows(): Promise<CloudFlowSummary[]>;
	/** 新建一支雲端流程（伺服器用流程核心照新建表單的名字、場地建）。 */
	createFlow(input: NewFlowInput): Promise<CloudFlowSummary>;
	/** 拿一支雲端流程；沒有這支、不是我的是 null。 */
	cloudFlow(id: string): Promise<CloudFlow | null>;
	/** 連一支雲端流程的房間（#248）：先送打招呼（指紋、分頁 id、上次看到第幾步），再一步一步送。 */
	openRoom(flowId: string): FlowRoom;
	/**
	 * 把一個音樂檔傳上雲端（#249）：伺服器查權限、發預簽網址，瀏覽器直接傳到 R2，傳完伺服器查大小。
	 * audioId 是流程裡這個音樂檔的 id。伺服器說太大（超過 60 MB）是 'tooBig'；其他做不成丟 ServerUnreachable。
	 */
	uploadAudio(flowId: string, audioId: string, file: File): Promise<'ok' | 'tooBig'>;
	/** 從雲端拿一個音樂檔（拿下載的預簽網址，再從 R2 拿）；雲端上沒有是 null。 */
	audioBytes(flowId: string, audioId: string): Promise<Uint8Array | null>;

	/** 忘記密碼：寄設密碼信。有沒有這個帳號都一樣（伺服器不說）。 */
	forgotPassword(email: string): Promise<void>;
	/** 改自己的名字，回改好的自己；沒登入是 null。 */
	changeName(name: string): Promise<Me | null>;
	/** 改密碼（要對現在的密碼）；改好後其他裝置都登出，這台還登入著。 */
	changePassword(current: string, password: string): Promise<ChangePasswordResult>;
}

/** 真的：fetch 同一個網址的 /api/…。伺服器出錯、連不上丟 ServerUnreachable（me 例外：當作沒登入）。 */
export function httpServer(base = ''): ServerAdapter {
	async function post(path: string, body: unknown): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(`${base}/api/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch {
			throw new ServerUnreachable();
		}
		// 503 是寄信服務今天的額度用完了（內容寫著 mailQuota），交給管理的事自己看。
		if (res.status >= 500 && res.status !== 503) throw new ServerUnreachable();
		return res;
	}
	async function admin(path: string, body: unknown = {}): Promise<AdminResult> {
		const res = await post(`admin/users${path}`, body);
		if (res.ok) return 'ok';
		if (res.status === 409 || res.status === 503) {
			try {
				return (await res.json()) as AdminProblem;
			} catch {
				// 不是我們的伺服器回的 503（例：前面的 proxy）
			}
		}
		throw new ServerUnreachable();
	}
	async function get(path: string): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(`${base}/api/${path}`);
		} catch {
			throw new ServerUnreachable();
		}
		if (res.status >= 500) throw new ServerUnreachable();
		return res;
	}
	return {
		async me() {
			try {
				const res = await fetch(`${base}/api/me`);
				return res.ok ? ((await res.json()) as Me) : null;
			} catch {
				return null;
			}
		},
		async loginExpired() {
			try {
				const res = await fetch(`${base}/api/me`);
				return res.status === 401 && ((await res.json()) as SignedOut).expired;
			} catch {
				return false;
			}
		},
		async login(email, password) {
			const res = await post('login', { email, password });
			if (res.ok) return 'ok';
			if (res.status === 401) return 'wrong';
			if (res.status === 429) return (await res.json()) as TooManyTries;
			throw new ServerUnreachable();
		},
		async logout() {
			await post('logout', {});
		},
		async passwordLink(token) {
			const res = await post('password-link', { token });
			if (res.ok) return (await res.json()) as LinkInfo;
			if (res.status === 410) return null;
			throw new ServerUnreachable();
		},
		async setPassword(token, password) {
			const res = await post('set-password', { token, password });
			if (res.ok) return 'ok';
			if (res.status === 410) return 'gone';
			if (res.status === 422) return (await res.json()) as PasswordProblem;
			throw new ServerUnreachable();
		},
		async listUsers() {
			let res: Response;
			try {
				res = await fetch(`${base}/api/admin/users`);
			} catch {
				throw new ServerUnreachable();
			}
			if (res.ok) return (await res.json()) as UserRow[];
			if (res.status === 401 || res.status === 403) return null;
			throw new ServerUnreachable();
		},
		addUser: (email, name) => admin('', { email, name }),
		resendInvite: (id) => admin(`/${id}/resend-invite`),
		sendReset: (id) => admin(`/${id}/send-reset`),
		changeEmail: (id, email) => admin(`/${id}/email`, { email }),
		disableUser: (id) => admin(`/${id}/disable`),
		enableUser: (id) => admin(`/${id}/enable`),
		async myFlows() {
			const res = await get('flows');
			if (res.ok) return ((await res.json()) as MyFlows).mine;
			throw new ServerUnreachable();
		},
		async createFlow(input) {
			const res = await post('flows', input);
			if (res.ok) return (await res.json()) as CloudFlowSummary;
			throw new ServerUnreachable();
		},
		async cloudFlow(id) {
			const res = await get(`flows/${encodeURIComponent(id)}`);
			if (res.ok) return (await res.json()) as CloudFlow;
			if (res.status === 404) return null;
			throw new ServerUnreachable();
		},
		openRoom(flowId) {
			const url = new URL(`${base}/api/flows/${encodeURIComponent(flowId)}/room`, location.href);
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
			const socket = new WebSocket(url);
			const waiting: string[] = [];
			const room: FlowRoom = {
				onmessage: () => {},
				send(request) {
					const text = JSON.stringify(request);
					if (socket.readyState === WebSocket.OPEN) socket.send(text);
					else waiting.push(text);
				},
				close: () => socket.close()
			};
			socket.onopen = () => {
				for (const text of waiting.splice(0)) socket.send(text);
			};
			socket.onmessage = (e) => room.onmessage(JSON.parse(e.data as string) as RoomMessage);
			return room;
		},
		async uploadAudio(flowId, audioId, file) {
			const flow = `flows/${encodeURIComponent(flowId)}/audio`;
			const ask: StartUpload = { audioId, fileName: file.name, size: file.size };
			const start = await post(flow, ask);
			if (start.status === 413) return 'tooBig';
			if (!start.ok) throw new ServerUnreachable();
			const { url } = (await start.json()) as Presigned;
			try {
				const put = await fetch(url, { method: 'PUT', body: file });
				if (!put.ok) throw new ServerUnreachable();
			} catch {
				throw new ServerUnreachable();
			}
			const done = await post(`${flow}/${encodeURIComponent(audioId)}/done`, {});
			if (done.status === 413) return 'tooBig';
			if (!done.ok) throw new ServerUnreachable();
			return 'ok';
		},
		async audioBytes(flowId, audioId) {
			const res = await get(`flows/${encodeURIComponent(flowId)}/audio/${encodeURIComponent(audioId)}`);
			if (res.status === 404) return null;
			if (!res.ok) throw new ServerUnreachable();
			const { url } = (await res.json()) as Presigned;
			try {
				// 從 R2 拿（別的網址）：R2 bucket 的 CORS 要准這個網站（docs/deploy.md）。
				const file = await fetch(url, { mode: 'cors' });
				if (!file.ok) throw new ServerUnreachable();
				return new Uint8Array(await file.arrayBuffer());
			} catch {
				throw new ServerUnreachable();
			}
		},
		async forgotPassword(email) {
			const res = await post('forgot-password', { email });
			if (!res.ok) throw new ServerUnreachable();
		},
		async changeName(name) {
			const res = await post('account/name', { name });
			if (res.ok) return (await res.json()) as Me;
			if (res.status === 401) return null;
			throw new ServerUnreachable();
		},
		async changePassword(current, password) {
			const res = await post('account/password', { current, password });
			if (res.ok) return 'ok';
			if (res.status === 403) return 'wrong';
			if (res.status === 429) return (await res.json()) as TooManyTries;
			if (res.status === 422) return (await res.json()) as PasswordProblem;
			throw new ServerUnreachable();
		}
	};
}
