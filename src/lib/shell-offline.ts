// App 裡的離線存放（#383）：雲端流程還沒傳的紀錄、離線副本（含音樂）、這台登入的是誰不存在網頁的 IndexedDB（系統可能清掉），
// 問殼，殼存在 App 自己的 Application Support/Offline（不進 iCloud 備份）。說的話寫在 bridge-scenarios/current/offline.json
// （殼那邊是 ios/ShellCore 的 OfflinePart）。存的樣子跟網頁版一樣帶版號（storedCopy、storedUnsent），殼原樣存、原樣回。
// 音樂一個檔一句（位元組用 base64），列離線副本時不帶音樂。讀不到當作沒有、存不了吞掉，跟網頁版的 IndexedDB 一樣。
// 網頁版照舊用 #lib/offline-store.js 的 IndexedDB。

import type { Shell } from '#lib/host.js';
import { isEmptyUnsent, readCopy, readUnsent, storedCopy, storedUnsent, type OfflineStore, type SignedInHere } from '#lib/offline-store.js';

/** 「問殼」can() 的名字：殼會存離線存放。 */
export const OFFLINE_FEATURE = 'offline';

export function shellOfflineStore(shell: Shell): OfflineStore {
	const ask = (name: string, body?: unknown) => shell.send(name, body);
	/** 讀：殼回錯當作沒有。 */
	const read = async <T>(name: string, body: unknown, none: T): Promise<T> => {
		try {
			return ((await ask(name, body)) as T) ?? none;
		} catch {
			return none;
		}
	};
	/** 寫：存不了就算了（跟網頁版一樣）。 */
	const write = async (...said: [string, unknown?][]) => {
		try {
			for (const [name, body] of said) await ask(name, body);
		} catch {
			// 存不了：只留在這次打開
		}
	};
	return {
		async unsent() {
			return (await read<unknown[]>('unsentList', undefined, [])).flatMap((v) => readUnsent(v) ?? []);
		},
		saveUnsent(u) {
			return isEmptyUnsent(u) ? write(['unsentDrop', { flowId: u.flowId }]) : write(['unsentSave', { flowId: u.flowId, value: storedUnsent(u) }]);
		},
		clearUnsent: () => write(['unsentClear']),
		needsHomeScreen: () => false,
		homeScreenKnown() {},
		async copies() {
			return (await read<unknown[]>('copyList', undefined, [])).flatMap((v) => readCopy(v) ?? []);
		},
		async copyAudio(flowId) {
			const audio: Record<string, Uint8Array> = {};
			for (const audioId of await read<string[]>('copyAudioList', { flowId }, [])) {
				const bytes = await read<string | null>('copyAudioLoad', { flowId, audioId }, null);
				if (bytes) audio[audioId] = Uint8Array.fromBase64(bytes);
			}
			return audio;
		},
		saveCopy(copy, audio) {
			const flowId = copy.flowId;
			return write(
				['copySave', { flowId, value: storedCopy(copy) }],
				...(audio
					? [
							['copyAudioKeep', { flowId, ids: Object.keys(audio) }] as [string, unknown],
							...Object.entries(audio).map(([audioId, bytes]): [string, unknown] => ['copyAudioSave', { flowId, audioId, bytes: bytes.toBase64() }])
						]
					: [])
			);
		},
		dropCopy: (flowId) => write(['copyDrop', { flowId }]),
		clearCopies: () => write(['copiesClear']),
		async signedInHere() {
			const here = await read<SignedInHere | null>('signedInLoad', undefined, null);
			return here?.me ? here : null;
		},
		saveSignedInHere: (here) => write(['signedInSave', { value: structuredClone(here) }])
	};
}
