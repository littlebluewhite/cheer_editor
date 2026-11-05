// 分頁頻道：同一個瀏覽器開著的編輯器分頁之間傳話。草稿每支流程一份；打開、清掉一支流程的草稿前，先問有沒有別的分頁正在編這支流程。
// 真的用 BroadcastChannel；沒有 BroadcastChannel 的瀏覽器沒有分頁頻道，當作沒有別的分頁。測試用 #lib/test-fakes.js 的 fakeTabs。

/** 分頁之間傳的話：「有人正在編這支流程（草稿 id）嗎？」和回答「正在編」。 */
export type TabMessage = { kind: 'editing?'; id: string } | { kind: 'editing'; id: string };

export interface TabChannel {
	/** 送給別的分頁（自己收不到）。 */
	post(message: TabMessage): void;
	/** 收別的分頁送來的話。回傳不再收。 */
	listen(on: (message: TabMessage) => void): () => void;
	/** 頁面關掉：不再收、不再送。 */
	close(): void;
}

/** 開一個分頁頻道（頁面打開時開，關掉時關）。 */
export type OpenTabChannel = () => TabChannel;

const NAME = 'cheer-editor-draft';

/** 真的分頁頻道：BroadcastChannel；瀏覽器沒有就是 null。 */
export function browserTabChannel(): OpenTabChannel | null {
	if (typeof BroadcastChannel !== 'function') return null;
	return () => {
		const channel = new BroadcastChannel(NAME);
		return {
			post: (message) => channel.postMessage(message),
			listen(on) {
				const heard = (e: MessageEvent) => on(e.data);
				channel.addEventListener('message', heard);
				return () => channel.removeEventListener('message', heard);
			},
			close: () => channel.close()
		};
	};
}
