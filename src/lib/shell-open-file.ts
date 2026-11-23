// 在 App 裡打開流程檔（#384，ADR 0024）：殼不拆檔，只交檔名和位元組（base64），網頁照開檔的規則打開（src/lib/flow-file.svelte.ts）。
// 「檔案」點 .cheer、分享選單交給 App 的：殼收著，App 開著就說 fileOpened，網頁再拿（takeOpenedFile，拿過就沒了）；App 剛打開，網頁一開始就先拿。
// App 裡按「開啟流程檔」：殼叫出選檔畫面（pickFlowFile，選得到 .zip、.cheer）。說的話：bridge-scenarios/current/openFile.json。
import type { Shell } from '#lib/host.js';
import type { FileSaver, PickedFile } from '#lib/file/save.js';

/** 「問殼」can() 的名字：殼會把交給 App 的流程檔給網頁、會叫出選檔畫面。 */
export const OPEN_FILE_FEATURE = 'openFile';

/** 殼交過來的檔：檔名和位元組（base64）。沒有是 null。 */
function fileOf(reply: unknown): File | null {
	if (!reply || typeof reply !== 'object') return null;
	const { name, bytes } = reply as { name?: unknown; bytes?: unknown };
	if (typeof name !== 'string' || typeof bytes !== 'string') return null;
	return new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], name);
}

/** 拿殼收著的那個流程檔（從「檔案」、分享選單交給 App 的）；沒有、殼出錯是 null。 */
export async function takeOpenedFile(shell: Shell): Promise<File | null> {
	try {
		return fileOf(await shell.send('takeOpenedFile'));
	} catch {
		return null;
	}
}

/** App 裡的「開啟流程檔」：請殼叫出選檔畫面。按取消回 null。存檔照 createSaver 建的（現在跟別的流程一樣；蓋回原檔在 #385）。 */
export function shellFilePicker(shell: Shell, createSaver: () => FileSaver): () => Promise<PickedFile | null> {
	return async () => {
		const file = fileOf(await shell.send('pickFlowFile'));
		return file && { file, saver: createSaver() };
	};
}
