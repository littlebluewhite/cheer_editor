// 連伺服器的 adapter：所有 HTTP 呼叫都經過它（ADR 0012：API 跟網頁同一個網址，cookie 由瀏覽器帶）。
// 真的是 httpServer；假的是 #lib/test-fakes.js 的 fakeServer（前端測試不開真的伺服器）。
// 訊息的型別從 Rust 產生（src/lib/api-types/，見 docs/deploy.md），對不上就編譯不過。
import type { FlowDocument, NewFlowInput } from '#lib/core';
import { host } from '#lib/host.js';
import type { CloudFlow } from '#lib/api-types/CloudFlow.js';
import type { FlowBlocked } from '#lib/api-types/FlowBlocked.js';
import type { CloudFlowSummary } from '#lib/api-types/CloudFlowSummary.js';
import type { CloudRecord } from '#lib/api-types/CloudRecord.js';
import type { DeleteSummary } from '#lib/api-types/DeleteSummary.js';
import type { LinkInfo } from '#lib/api-types/LinkInfo.js';
import type { LinkedFlow } from '#lib/api-types/LinkedFlow.js';
import type { Me } from '#lib/api-types/Me.js';
import type { MyFlows } from '#lib/api-types/MyFlows.js';
import type { Person } from '#lib/api-types/Person.js';
import type { Role } from '#lib/api-types/Role.js';
import type { ShareProblem } from '#lib/api-types/ShareProblem.js';
import type { SharedFlowSummary } from '#lib/api-types/SharedFlowSummary.js';
import type { PasswordProblem } from '#lib/api-types/PasswordProblem.js';
import type { Present } from '#lib/api-types/Present.js';
import type { Presigned } from '#lib/api-types/Presigned.js';
import type { RoomMessage } from '#lib/api-types/RoomMessage.js';
import type { SentBack } from '#lib/api-types/SentBack.js';
import type { RoomRequest } from '#lib/api-types/RoomRequest.js';
import type { RunView } from '#lib/api-types/RunView.js';
import type { ShareLink } from '#lib/api-types/ShareLink.js';
import type { SignedOut } from '#lib/api-types/SignedOut.js';
import type { StartUpload } from '#lib/api-types/StartUpload.js';
import type { TooManyTries } from '#lib/api-types/TooManyTries.js';
import type { AdminProblem } from '#lib/api-types/AdminProblem.js';
import type { HandedOver } from '#lib/api-types/HandedOver.js';
import type { UserRow } from '#lib/api-types/UserRow.js';
import type { UserStatus } from '#lib/api-types/UserStatus.js';
import { OLD_SITE } from '#lib/old-site.js';
import { m } from '#lib/paraglide/messages.js';

export type {
	AdminProblem,
	HandedOver,
	CloudFlow,
	CloudFlowSummary,
	CloudRecord,
	DeleteSummary,
	LinkInfo,
	LinkedFlow,
	Me,
	MyFlows,
	PasswordProblem,
	Person,
	Present,
	Role,
	RoomMessage,
	RoomRequest,
	RunView,
	SentBack,
	ShareProblem,
	SharedFlowSummary,
	TooManyTries,
	UserRow,
	UserStatus
};

/** 房間斷線的原因（#260）：斷網、伺服器沒回應、登入超過 30 天（或在別的地方登出了）。 */
export type RoomDown = 'offline' | 'unreachable' | 'expired';

/**
 * 一支雲端流程的房間（WebSocket）：送步、收伺服器的回答。第一次還沒連上時送的先排著，連上就送。
 * 斷線了（網路斷、部署切換）自己重連（#255）；斷線時送的丟掉，連回來要重新打招呼。
 * 斷線時說為什麼（#260）：斷網等連上網路就連；登入過期不再自己連（重登後再打開）。
 */
export interface FlowRoom {
	send(request: RoomRequest): void;
	/** 收到伺服器說的話（房間建好後接上）。 */
	onmessage: (message: RoomMessage) => void;
	/** 斷線了（false，帶為什麼；原因變了會再說一次），又連上了（true）。 */
	onconnection: (connected: boolean, why?: RoomDown) => void;
	/** 「現在再試」（#260）：斷線的話馬上再連一次。 */
	retry(): void;
	/** 不用了：關掉，不再重連。 */
	close(): void;
}

/** 傳上雲端的流程（flow.json 的內容，不含音樂）最多幾個 byte：跟伺服器的 UPLOAD_LIMIT（server/src/lib.rs）一樣。 */
export const MAX_CLOUD_FLOW_BYTES = 16 * 1024 * 1024;

/** 斷線後隔多久重連（伺服器沒回應時也是多久自動再試一次，#260）：1、2、4、8 秒，之後每 10 秒。 */
const RECONNECT_MS = [1000, 2000, 4000, 8000, 10000];

/** 管理的事的結果：做好了，或做不成的原因（email 撞到別人、今天寄不出去、這個人現在不能這樣做）。 */
export type AdminResult = 'ok' | AdminProblem;

/** 設密碼的結果：設好、連結不能用了（過期、用過、亂改的），或密碼不收的原因。 */
export type SetPasswordResult = 'ok' | 'gone' | PasswordProblem;

/** 改密碼的結果：改好、現在的密碼不對、試太多次（鎖住），或新密碼不收的原因。 */
export type ChangePasswordResult = 'ok' | 'wrong' | TooManyTries | PasswordProblem;

/** 「試太多次了，請 N 秒後再試」：一分鐘以上寫幾分鐘（不滿一分鐘算一分鐘）。 */
export function tooManyTriesText({ retryAfter }: TooManyTries): string {
	if (retryAfter < 60) return retryAfter === 1 ? m.login_too_many_seconds_one({ n: 1 }) : m.login_too_many_seconds({ n: retryAfter });
	const n = Math.ceil(retryAfter / 60);
	return n === 1 ? m.login_too_many_minutes_one({ n }) : m.login_too_many_minutes({ n });
}

/** 伺服器出錯、連不上（斷網、伺服器沒回應）。 */
export class ServerUnreachable extends Error {
	constructor() {
		super('連不上伺服器');
	}
}

export interface ServerAdapter {
	/** 我是誰；伺服器說沒登入（或登入超過 30 天）是 null，連不上伺服器是 undefined。 */
	me(): Promise<Me | null | undefined>;
	/** 沒登入是因為登入超過 30 天了（不是沒登入過、不是登出了）。 */
	loginExpired(): Promise<boolean>;
	/** 登入：'wrong' 是 email 或密碼不對（沒這個人、被停用也一樣）；猜錯太多次是要等幾秒。 */
	login(email: string, password: string): Promise<'ok' | 'wrong' | TooManyTries>;
	/** 登出這台裝置。沒登出成（伺服器出錯、連不上）丟 ServerUnreachable。 */
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
	/** 刪除帳號（#369）：只有已停用的人，不能恢復；他擁有的流程一起刪，他收到「刪好了」的信。 */
	deleteUser(id: number): Promise<AdminResult>;
	/** 移交（#252）：被停用的人擁有的流程全部交給 email 那個人；回交出去幾支，或做不成的原因。 */
	adminHandOver(id: number, email: string): Promise<HandedOver | AdminProblem>;

	/** 我的流程（我擁有的雲端流程）、分享給我的，最近改的在前。 */
	myFlows(): Promise<MyFlows>;
	/** 新建一支雲端流程（伺服器用流程核心照新建表單的名字、場地建）。 */
	createFlow(input: NewFlowInput): Promise<CloudFlowSummary>;
	/**
	 * 傳上雲端（#259）：送流程檔的 flow.json 內容（帶成功率紀錄），伺服器檢查整支流程，過了建一支新的雲端流程（我是擁有者）。
	 * 不收回原因（超過 16 MB 也是，share_flow_too_big）。音樂檔另外用 uploadAudio 傳。
	 */
	uploadFlow(doc: FlowDocument): Promise<CloudFlowSummary | FlowBlocked>;
	/** 拿一支雲端流程（帶我的權限）；沒有這支、沒有權限、被刪了是 null。 */
	cloudFlow(id: string): Promise<CloudFlow | null>;

	// 分享（#250）：分享、改權限、收回只有擁有者能做；離開只有不是擁有者的能做。
	/** 有權限的人（擁有者在最前面）；只有擁有者拿得到別人的 email。沒有權限是 null。 */
	people(flowId: string): Promise<Person[] | null>;
	/** 用 email 分享：加好回新的名單；加不進去回原因。 */
	share(flowId: string, email: string, role: Role): Promise<Person[] | ShareProblem>;
	/** 改一個人的權限，回新的名單。 */
	setRole(flowId: string, userId: number, role: Role): Promise<Person[]>;
	/** 收回一個人的權限（不用確認），回新的名單。 */
	revoke(flowId: string, userId: number): Promise<Person[]>;
	/** 離開這支流程。 */
	leave(flowId: string): Promise<void>;
	/** 移交（#252）：把流程交給名單上的一個人，我變編輯者；回新的名單（沒有 email），他被停用了回原因。 */
	handOver(flowId: string, userId: number): Promise<Person[] | ShareProblem>;
	/** 刪掉這支流程（#252，只有擁有者）：所有人都打不開。 */
	deleteFlow(flowId: string): Promise<void>;

	// 分享連結（#251）：一支流程一條，只有擁有者能開、關；有權限的人都看得到。
	/** 分享連結開著是連結的那串字，關著是 null。 */
	shareLink(flowId: string): Promise<string | null>;
	/** 擁有者開、關分享連結，回現在的（開著再開還是同一條；關掉再打開換新的）。 */
	switchShareLink(flowId: string, on: boolean): Promise<string | null>;
	/** 用分享連結打開（不用登入）：編排沒有紀錄；已經登入、有權限的帶自己的權限。連結不能用了是 null。 */
	linkedFlow(token: string): Promise<LinkedFlow | null>;
	/** 用分享連結拿一個音樂檔；沒有是 null。 */
	linkAudioBytes(token: string, audioId: string): Promise<Uint8Array | null>;
	/**
	 * 連一支雲端流程的房間（#248）：先送打招呼（指紋、分頁 id、上次看到第幾步、在編輯還是檢視），再一步一步送。
	 * 別人的改動、誰開著也從房間來（#253）。
	 */
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
	/** 要求刪除帳號的確認框（#370）：我擁有幾支流程、幾支有分享；沒登入是 null。 */
	deleteSummary(): Promise<DeleteSummary | null>;
	/**
	 * 要求刪除帳號（#370）：帳號馬上停用（每台裝置登出），寄我和管理員各一封信。
	 * 寄信服務今天的額度用完是 'mailQuota'（什麼都沒改）；其他做不成丟 ServerUnreachable。
	 */
	requestDelete(): Promise<'ok' | 'mailQuota'>;
}

/**
 * 舊網址版（#267）：沒有伺服器，不 fetch、不開 WebSocket。我是誰：沒登入；其他都是連不上（ServerUnreachable）。
 */
function noServer(): ServerAdapter {
	const unreachable = () => Promise.reject(new ServerUnreachable());
	const known: Partial<ServerAdapter> = {
		me: async () => null,
		loginExpired: async () => false,
		openRoom: () => {
			throw new ServerUnreachable();
		}
	};
	return new Proxy(known, { get: (t, k) => t[k as keyof ServerAdapter] ?? unreachable }) as ServerAdapter;
}

/** 殼會代傳雲端流程的音樂（情境 bridge-scenarios/current/cloudMusic.json）。 */
export const CLOUD_MUSIC_FEATURE = 'cloudMusic';

/**
 * 從 R2 拿、傳到 R2（預簽網址；file 有給是傳）。R2 只放行網站的網址：App 裡（殼會 cloudMusic）交給殼的 /cloud-music
 * （#382，ios/ShellCore/Sources/ShellCore/Forward/CloudMusic.swift），File 的內容進不了殼，先轉成 ArrayBuffer。
 */
async function r2Fetch(url: string, file?: File): Promise<Response> {
	if (!host().shell.can(CLOUD_MUSIC_FEATURE)) return fetch(url, file ? { method: 'PUT', body: file } : { mode: 'cors' });
	const viaShell = `/cloud-music?url=${encodeURIComponent(url)}`;
	return fetch(viaShell, file ? { method: 'PUT', body: await file.arrayBuffer() } : undefined);
}

/** 真的：fetch 同一個網址的 /api/…。伺服器出錯、連不上丟 ServerUnreachable（me 例外：當作沒登入）。舊網址版不連（noServer）。 */
export function httpServer(base = ''): ServerAdapter {
	if (OLD_SITE) return noServer();
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
	/** 拿下載的預簽網址（path），再從 R2 拿那個檔；沒有是 null。 */
	async function presignedBytes(path: string): Promise<Uint8Array | null> {
		const res = await get(path);
		if (res.status === 404) return null;
		if (!res.ok) throw new ServerUnreachable();
		const { url } = (await res.json()) as Presigned;
		try {
			// 從 R2 拿（別的網址）：R2 bucket 的 CORS 要准這個網站（docs/deploy.md）；App 裡經過殼。
			const file = await r2Fetch(url);
			if (!file.ok) throw new ServerUnreachable();
			return new Uint8Array(await file.arrayBuffer());
		} catch {
			throw new ServerUnreachable();
		}
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
				return undefined;
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
			// 沒登入也回 204；不是 2xx（例：擋 CSRF 的 403）就是沒登出，伺服器上還登入著。
			const res = await post('logout', {});
			if (!res.ok) throw new ServerUnreachable();
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
		deleteUser: (id) => admin(`/${id}/delete`),
		async adminHandOver(id, email) {
			const res = await post(`admin/users/${id}/transfer`, { email });
			if (res.ok || res.status === 409) return (await res.json()) as HandedOver | AdminProblem;
			throw new ServerUnreachable();
		},
		async myFlows() {
			const res = await get('flows');
			if (res.ok) return (await res.json()) as MyFlows;
			throw new ServerUnreachable();
		},
		async createFlow(input) {
			const res = await post('flows', input);
			if (res.ok) return (await res.json()) as CloudFlowSummary;
			throw new ServerUnreachable();
		},
		async uploadFlow(doc) {
			// 伺服器只收 16 MB 以下：先擋，不然它回 413 會被當成連不上
			if (new Blob([JSON.stringify(doc)]).size > MAX_CLOUD_FLOW_BYTES) return { message: m.share_flow_too_big() };
			const res = await post('flows/upload', doc);
			if (res.status === 413) return { message: m.share_flow_too_big() };
			if (res.ok || res.status === 422) return (await res.json()) as CloudFlowSummary | FlowBlocked;
			throw new ServerUnreachable();
		},
		async cloudFlow(id) {
			const res = await get(`flows/${encodeURIComponent(id)}`);
			if (res.ok) return (await res.json()) as CloudFlow;
			// 410：被擁有者刪了
			if (res.status === 404 || res.status === 410) return null;
			throw new ServerUnreachable();
		},
		async people(flowId) {
			const res = await get(`flows/${encodeURIComponent(flowId)}/people`);
			if (res.ok) return (await res.json()) as Person[];
			if (res.status === 404) return null;
			throw new ServerUnreachable();
		},
		async share(flowId, email, role) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/people`, { email, role });
			if (res.ok || res.status === 409) return (await res.json()) as Person[] | ShareProblem;
			throw new ServerUnreachable();
		},
		async setRole(flowId, userId, role) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/people/${userId}/role`, { role });
			if (res.ok) return (await res.json()) as Person[];
			throw new ServerUnreachable();
		},
		async revoke(flowId, userId) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/people/${userId}/remove`, {});
			if (res.ok) return (await res.json()) as Person[];
			throw new ServerUnreachable();
		},
		async leave(flowId) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/leave`, {});
			if (!res.ok) throw new ServerUnreachable();
		},
		async handOver(flowId, userId) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/people/${userId}/owner`, {});
			if (res.ok || res.status === 409) return (await res.json()) as Person[] | ShareProblem;
			throw new ServerUnreachable();
		},
		async deleteFlow(flowId) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/delete`, {});
			if (!res.ok) throw new ServerUnreachable();
		},
		openRoom(flowId) {
			const url = new URL(`${base}/api/flows/${encodeURIComponent(flowId)}/room`, host().siteUrl());
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
			const waiting: string[] = [];
			/** 連著（或第一次還在連）；斷線後到連回來之前是 false。 */
			let up = true;
			let closed = false;
			let tries = 0;
			/** 上次說的斷線原因（變了才再說）。 */
			let lastWhy: RoomDown | null = null;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let socket: WebSocket | null = null;
			const room: FlowRoom = {
				onmessage: () => {},
				onconnection: () => {},
				send(request) {
					const text = JSON.stringify(request);
					if (socket?.readyState === WebSocket.OPEN) socket.send(text);
					else if (up) waiting.push(text);
				},
				retry() {
					if (closed || up || socket) return;
					tries = 0;
					connect();
				},
				close() {
					closed = true;
					clearTimeout(timer);
					window.removeEventListener('online', online);
					window.removeEventListener('offline', offline);
					socket?.close();
				}
			};
			/** 連上網路了：斷線的話馬上再連。 */
			const online = () => room.retry();
			/** 瀏覽器說斷網了：WebSocket 不一定馬上發現，自己關掉。 */
			const offline = () => socket?.close();
			window.addEventListener('online', online);
			window.addEventListener('offline', offline);
			/** 斷了：問問看為什麼（斷網、登入過期、被收回、流程被刪了（410）、伺服器沒回應）。 */
			const why = async (): Promise<RoomDown | 'revoked' | 'deleted'> => {
				if (!navigator.onLine) return 'offline';
				try {
					const me = await fetch(`${base}/api/me`);
					if (me.status === 401) return 'expired';
					if (!me.ok) return 'unreachable';
					const flow = await fetch(`${base}/api/flows/${encodeURIComponent(flowId)}`);
					if (flow.status === 410) return 'deleted';
					return flow.status === 404 ? 'revoked' : 'unreachable';
				} catch {
					return navigator.onLine ? 'unreachable' : 'offline';
				}
			};
			const connect = () => {
				if (closed) return;
				clearTimeout(timer);
				const s = new WebSocket(url);
				socket = s;
				s.onopen = () => {
					tries = 0;
					lastWhy = null;
					if (up) {
						for (const text of waiting.splice(0)) s.send(text);
						return;
					}
					up = true;
					room.onconnection(true);
				};
				s.onmessage = (e) => room.onmessage(JSON.parse(e.data as string) as RoomMessage);
				s.onclose = () => {
					if (closed || socket !== s) return;
					socket = null;
					waiting.length = 0;
					up = false;
					void why().then((reason) => {
						if (closed || socket) return;
						// 被收回、流程被刪了：房間連不上了，回首頁說原因
						if (reason === 'revoked' || reason === 'deleted') return room.onmessage({ kind: reason });
						if (reason !== lastWhy) room.onconnection(false, reason);
						lastWhy = reason;
						// 登入過期：等重登，不自己再連（「現在再試」照樣能按）
						if (reason !== 'expired') timer = setTimeout(connect, RECONNECT_MS[Math.min(tries++, RECONNECT_MS.length - 1)]);
					});
				};
			};
			connect();
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
				const put = await r2Fetch(url, file);
				if (!put.ok) throw new ServerUnreachable();
			} catch {
				throw new ServerUnreachable();
			}
			const done = await post(`${flow}/${encodeURIComponent(audioId)}/done`, {});
			if (done.status === 413) return 'tooBig';
			if (!done.ok) throw new ServerUnreachable();
			return 'ok';
		},
		audioBytes: (flowId, audioId) => presignedBytes(`flows/${encodeURIComponent(flowId)}/audio/${encodeURIComponent(audioId)}`),
		async shareLink(flowId) {
			const res = await get(`flows/${encodeURIComponent(flowId)}/link`);
			if (res.ok) return ((await res.json()) as ShareLink).token;
			throw new ServerUnreachable();
		},
		async switchShareLink(flowId, on) {
			const res = await post(`flows/${encodeURIComponent(flowId)}/link`, { on });
			if (res.ok) return ((await res.json()) as ShareLink).token;
			throw new ServerUnreachable();
		},
		async linkedFlow(token) {
			const res = await get(`links/${encodeURIComponent(token)}`);
			if (res.ok) return (await res.json()) as LinkedFlow;
			if (res.status === 404) return null;
			throw new ServerUnreachable();
		},
		linkAudioBytes: (token, audioId) => presignedBytes(`links/${encodeURIComponent(token)}/audio/${encodeURIComponent(audioId)}`),
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
		},
		async deleteSummary() {
			const res = await get('account/delete');
			if (res.ok) return (await res.json()) as DeleteSummary;
			if (res.status === 401) return null;
			throw new ServerUnreachable();
		},
		async requestDelete() {
			const res = await post('account/delete', {});
			if (res.ok) return 'ok';
			if (res.status === 503) return 'mailQuota';
			throw new ServerUnreachable();
		}
	};
}
