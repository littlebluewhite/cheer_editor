// 網路 adapter：現在瀏覽器說有沒有網路，變了的時候通知。編輯器 module 收它（editor.online），編輯頁、首頁 module 都讀那裡。
// 真的伺服器 adapter（#lib/server-api.js 的 httpServer）建的時候也收它：房間連上網路馬上再連、斷網自己關、分斷線原因。
// 真的（browserNetwork）讀瀏覽器的 navigator.onLine 和 online、offline 事件（全專案只有這裡讀）；
// 假的（#lib/test-fakes.js 的 fakeNetwork）跟假伺服器的 network() 一起換。
// 不管：伺服器連不連得上（瀏覽器說有網路、伺服器沒回應是連伺服器那邊的事）。

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
