// 分享連結的網址（#251）：編輯器首頁後面加「#share=連結」。放在 # 後面：不送到伺服器、不進 log，也不會跟著 Referer 出去。
import { resolve } from '$app/paths';

const PREFIX = '#share=';

/** 給人的網址（分享對話框顯示、複製的）。 */
export function shareUrl(token: string): string {
	return new URL(`${resolve('/')}${PREFIX}${encodeURIComponent(token)}`, location.href).href;
}

/** 網址的 # 那段是分享連結就回連結的那串字，不是回 null。 */
export function shareTokenIn(hash: string): string | null {
	return hash.startsWith(PREFIX) && hash.length > PREFIX.length ? decodeURIComponent(hash.slice(PREFIX.length)) : null;
}
