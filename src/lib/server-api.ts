// 連伺服器的 adapter：所有 HTTP 呼叫都經過它（ADR 0009：API 跟網頁同一個網址，cookie 由瀏覽器帶）。
// 真的是 httpServer；假的是 #lib/test-fakes.js 的 fakeServer（前端測試不開真的伺服器）。
// 訊息的型別從 Rust 產生（src/lib/api-types/，見 docs/deploy.md），對不上就編譯不過。
import type { LinkInfo } from '#lib/api-types/LinkInfo.js';
import type { Me } from '#lib/api-types/Me.js';
import type { PasswordProblem } from '#lib/api-types/PasswordProblem.js';
import type { AdminProblem } from '#lib/api-types/AdminProblem.js';
import type { UserRow } from '#lib/api-types/UserRow.js';
import type { UserStatus } from '#lib/api-types/UserStatus.js';

export type { AdminProblem, LinkInfo, Me, PasswordProblem, UserRow, UserStatus };

/** 管理的事的結果：做好了，或做不成的原因（email 撞到別人、今天寄不出去、這個人現在不能這樣做）。 */
export type AdminResult = 'ok' | AdminProblem;

/** 設密碼的結果：設好、連結不能用了（過期、用過、亂改的），或密碼不收的原因。 */
export type SetPasswordResult = 'ok' | 'gone' | PasswordProblem;

/** 伺服器出錯、連不上（斷網、伺服器沒回應）。 */
export class ServerUnreachable extends Error {
	constructor() {
		super('連不上伺服器');
	}
}

export interface ServerAdapter {
	/** 我是誰；沒登入（或登入超過 30 天、連不上伺服器）是 null。 */
	me(): Promise<Me | null>;
	/** 登入：'wrong' 是 email 或密碼不對（沒這個人、被停用也一樣）。 */
	login(email: string, password: string): Promise<'ok' | 'wrong'>;
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
	return {
		async me() {
			try {
				const res = await fetch(`${base}/api/me`);
				return res.ok ? ((await res.json()) as Me) : null;
			} catch {
				return null;
			}
		},
		async login(email, password) {
			const res = await post('login', { email, password });
			if (res.ok) return 'ok';
			if (res.status === 401) return 'wrong';
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
		enableUser: (id) => admin(`/${id}/enable`)
	};
}
