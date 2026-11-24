// 在 App 裡打開流程檔（#384，ADR 0024）：殼不拆檔，只交檔名和位元組（base64），網頁照開檔的規則打開（src/lib/flow-file.svelte.ts）。
// 「檔案」點 .cheer、分享選單交給 App 的：殼收著，App 開著就說 fileOpened，網頁再拿（takeOpenedFile，拿過就沒了）；App 剛打開，網頁一開始就先拿。
// App 裡按「開啟流程檔」：殼叫出選檔畫面（pickFlowFile，選得到 .zip、.cheer）。說的話：bridge-scenarios/current/openFile.json。
import type { Shell } from '#lib/host.js';
import type { FileSaver, PickedFile } from '#lib/file/save.js';

/** 「問殼」can() 的名字：殼會把交給 App 的流程檔給網頁、會叫出選檔畫面。 */
export const OPEN_FILE_FEATURE = 'openFile';

/** 殼交過來的檔。target：原地打開的檔（「檔案」點的、選檔畫面選的）存回它用的書籤（#385）；分享選單給的副本是 null。 */
export interface HandedFile {
	file: File;
	target: string | null;
}

/** 殼交過來的檔：檔名、位元組（base64）、書籤。沒有是 null。 */
function fileOf(reply: unknown): HandedFile | null {
	if (!reply || typeof reply !== 'object') return null;
	const { name, bytes, target } = reply as { name?: unknown; bytes?: unknown; target?: unknown };
	if (typeof name !== 'string' || typeof bytes !== 'string') return null;
	return { file: new File([Uint8Array.fromBase64(bytes)], name), target: typeof target === 'string' ? target : null };
}

/** 拿殼收著的那個流程檔（從「檔案」、分享選單交給 App 的）；沒有是 null。殼讀不到那個檔（例：iCloud 上的檔下載不了）會丟錯，跟沒有分開。 */
export async function takeOpenedFile(shell: Shell): Promise<HandedFile | null> {
	return fileOf(await shell.send('takeOpenedFile'));
}

/** App 裡的「開啟流程檔」：請殼叫出選檔畫面。按取消回 null。存檔薄層用殼給的書籤建（createSaver），存檔蓋回選的那個檔（#385）。 */
export function shellFilePicker(shell: Shell, createSaver: (remembered?: string) => FileSaver): () => Promise<PickedFile | null> {
	return async () => {
		const picked = fileOf(await shell.send('pickFlowFile'));
		return picked && { file: picked.file, saver: createSaver(picked.target ?? undefined) };
	};
}
