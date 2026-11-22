// 網路 adapter：現在瀏覽器說有沒有網路，變了的時候通知。編輯器 module 收它（editor.online），編輯頁、首頁 module 都讀那裡。
// 真的（browserNetwork）讀瀏覽器的 navigator.onLine 和 online、offline 事件；假的（#lib/test-fakes.js 的 fakeNetwork）給測試切。
// 不管：伺服器連不連得上（瀏覽器說有網路、伺服器沒回應是連伺服器那邊的事）；房間怎麼判斷斷線（還在 #lib/server-api.js）。

export interface NetworkAdapter {
	/** 現在瀏覽器說有沒有網路。 */
	online(): boolean;
	/** 有沒有網路變了就叫 changed。回傳不再通知。 */
	onChange(changed: () => void): () => void;
}

/** 真的：瀏覽器的 navigator.onLine、online／offline 事件（沒有 navigator 的時候，例：建置時產生頁面，當作有網路）。 */
export function browserNetwork(): NetworkAdapter {
	return {
		online: () => typeof navigator === 'undefined' || navigator.onLine,
		onChange(changed) {
			window.addEventListener('online', changed);
			window.addEventListener('offline', changed);
			return () => {
				window.removeEventListener('online', changed);
				window.removeEventListener('offline', changed);
			};
		}
	};
}
