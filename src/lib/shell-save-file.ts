// App 裡存流程檔（#385）：存檔蓋回原本的檔、「傳給別人」、雲端流程下載成 .cheer。說的話：bridge-scenarios/current/saveFile.json。
// - 存檔：交殼「存到哪」（target，殼給的書籤）就蓋回那個檔；沒有就請殼問存到哪，存成「流程名.cheer」，記下殼回的書籤。
//   從「檔案」點進來、「開啟流程檔」選的原檔，殼交檔時就給了書籤（shell-open-file.ts）。書籤跟草稿一起記（flow-file.svelte.ts），App 關掉再開也蓋回去。
// - 傳給別人：殼叫出分享選單送「流程名.zip」（iPhone 的 LINE 不收 .cheer，#306、#364）。只有 App 有（網頁版在 iPad 存檔本來就是分享選單）。
// - 雲端流程「下載成流程檔」：每次都問存到哪，存成 .cheer，不記。
import type { Shell } from '#lib/host.js';
import type { FileSaver } from '#lib/file/save.js';

/** 「問殼」can() 的名字：殼會存流程檔（蓋回原檔、問存到哪）、會叫出分享選單送流程檔。 */
export const SAVE_FILE_FEATURE = 'saveFile';

/** 存檔的檔名「流程名.zip」換成 App 存進「檔案」用的「流程名.cheer」。 */
export function cheerFileName(fileName: string): string {
	return `${fileName.replace(/\.zip$/i, '')}.cheer`;
}

interface Saved {
	target: string | null;
	name: string;
}

/** 請殼存：有 target 蓋回那個檔，沒有（或那個檔不見了）問存到哪。按取消是 null。 */
async function saveInShell(shell: Shell, target: string | null, bytes: Uint8Array, fileName: string): Promise<Saved | null> {
	return (await shell.send('saveFlowFile', { target, name: cheerFileName(fileName), bytes: bytes.toBase64() })) as Saved | null;
}

/** App 裡一支流程的存檔薄層：target 是存回哪個檔（殼給的書籤）；沒有就第一次存檔時問存到哪。 */
export function shellSaver(shell: Shell, target: string | null): FileSaver {
	let name: string | undefined;
	return {
		get fileName() {
			return name;
		},
		get remembered() {
			return target ?? undefined;
		},
		async save(bytes, fileName) {
			const saved = await saveInShell(shell, target, bytes, fileName);
			if (!saved) return 'cancelled';
			target = saved.target;
			name = saved.name;
			return 'saved';
		}
	};
}

/** App 裡雲端流程的「下載成流程檔」：每次都問存到哪，存成 .cheer，不記。回存成的檔名（存檔畫面裡可以改名）。 */
export function shellAskWhere(shell: Shell): (bytes: Uint8Array, fileName: string) => Promise<'cancelled' | { savedAs: string }> {
	return async (bytes, fileName) => {
		const saved = await saveInShell(shell, null, bytes, fileName);
		return saved ? { savedAs: saved.name } : 'cancelled';
	};
}

/** 「傳給別人」：殼叫出分享選單送這個檔（iPad 從 button 那裡跳出來），回有沒有送出。 */
export async function shareFlowFile(
	shell: Shell,
	bytes: Uint8Array,
	fileName: string,
	button?: { x: number; y: number; width: number; height: number }
): Promise<boolean> {
	return (await shell.send('shareFlowFile', { name: fileName, bytes: bytes.toBase64(), ...(button && { button }) })) === true;
}
