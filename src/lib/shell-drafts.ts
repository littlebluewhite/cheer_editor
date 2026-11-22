// App 裡的草稿存放（#377）：草稿不存在網頁的 IndexedDB（系統可能清掉），問殼，殼存在 App 自己的 Application Support。
// 說的話寫在 bridge-scenarios/current/drafts.json（殼那邊是 ios/ShellCore 的 DraftsPart）。位元組用 base64 放在橋的 JSON 裡。
// 網頁版照舊用 #lib/file/draft.js 的 IndexedDB。

import type { Draft, DraftInfo, DraftStore } from '#lib/file/draft.js';
import type { Shell } from '#lib/host.js';

/** 「問殼」can() 的名字：殼會存草稿。 */
export const DRAFTS_FEATURE = 'drafts';

interface Saved {
	id: string;
	savedAt: number;
}

export function shellDraftStore(shell: Shell): DraftStore {
	return {
		async list() {
			const saved = (await shell.send('draftList')) as Saved[];
			return saved.map((d): DraftInfo => ({ id: d.id, savedAt: new Date(d.savedAt) }));
		},
		async load(id) {
			const d = (await shell.send('draftLoad', { id })) as { bytes: string; savedAt: number } | null;
			return d && ({ id, bytes: Uint8Array.fromBase64(d.bytes), savedAt: new Date(d.savedAt) } satisfies Draft);
		},
		// 不是 async：呼叫當下就送給殼（切到背景那一下存的，不能先等別的）
		save(id, bytes) {
			return shell.send('draftSave', { id, bytes: bytes.toBase64() }).then(() => {});
		},
		async clear(id) {
			await shell.send('draftClear', { id });
		}
	};
}
