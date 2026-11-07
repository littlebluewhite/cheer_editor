// 連伺服器的 adapter：所有 HTTP 呼叫都經過它（ADR 0009：API 跟網頁同一個網址，cookie 由瀏覽器帶）。
// 真的是 httpServer；假的是 #lib/test-fakes.js 的 fakeServer（前端測試不開真的伺服器）。
// 訊息的型別從 Rust 產生（src/lib/api-types/，見 docs/deploy.md），對不上就編譯不過。
import type { LinkInfo } from '#lib/api-types/LinkInfo.js';
import type { Me } from '#lib/api-types/Me.js';
import type { PasswordProblem } from '#lib/api-types/PasswordProblem.js';
import type { SignedOut } from '#lib/api-types/SignedOut.js';
import type { TooManyTries } from '#lib/api-types/TooManyTries.js';

export type { LinkInfo, Me, PasswordProblem, TooManyTries };

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
