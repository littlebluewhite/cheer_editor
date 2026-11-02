// 存檔薄層：把流程檔的位元組寫到教練的電腦。
// Chrome、Edge 有 File System Access：第一次跳存檔對話框，之後蓋回同一個檔。
// Safari、Firefox 沒有（見 docs/research/browser-capabilities.md），每次都下載一個新檔。
// 這一層不寫自動測試，改用手動檢查（規格的 Testing Decisions）；頁面測試換成假的 FileSaver。

/** saved = 寫進檔案了；downloaded = 下載了一個新檔；cancelled = 教練在存檔對話框按了取消。 */
export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

/** 一支流程一個：記得上次存到哪個檔，下次存回同一個。開別的流程時換一個新的。 */
export interface FileSaver {
	save(bytes: Uint8Array, fileName: string): Promise<SaveOutcome>;
}

/** File System Access 裡用到的那一點（TypeScript 的 lib.dom 沒有 showSaveFilePicker）。 */
interface SavePickerWindow {
	showSaveFilePicker(options: {
		suggestedName: string;
		types: { description: string; accept: Record<string, string[]> }[];
	}): Promise<FileSystemFileHandle>;
}

export function createBrowserSaver(): FileSaver {
	let handle: FileSystemFileHandle | null = null;
	return {
		async save(bytes, fileName) {
			if (!('showSaveFilePicker' in window)) {
				download(bytes, fileName);
				return 'downloaded';
			}
			if (!handle) {
				try {
					handle = await (window as unknown as SavePickerWindow).showSaveFilePicker({
						suggestedName: fileName,
						types: [{ description: '流程檔', accept: { 'application/zip': ['.zip'] } }]
					});
				} catch (e) {
					if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
					throw e;
				}
			}
			const writable = await handle.createWritable();
			await writable.write(bytes as Uint8Array<ArrayBuffer>);
			await writable.close();
			return 'saved';
		}
	};
}

function download(bytes: Uint8Array, fileName: string) {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	// 等瀏覽器開始下載再放掉。
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
