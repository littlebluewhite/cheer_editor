// 存檔薄層：把流程檔的位元組寫到教練的電腦。
// Chrome、Edge 有 File System Access：用它開檔的流程，存檔就存回那個檔；新建的第一次跳存檔對話框，之後蓋回同一個檔。
// Safari、Firefox 沒有（見 docs/research/browser-capabilities.md），每次都下載一個新檔。
// iPad（觸控螢幕、能分享檔案）改開分享選單：存到「檔案」App，或直接用 LINE 傳給隊員（docs/adr/0005-ipad-touch.md）。
// 這一層不寫自動測試，改用手動檢查（規格的 Testing Decisions）；頁面測試換成假的 FileSaver。

/** saved = 寫進檔案了；shared = 交給分享選單了；downloaded = 下載了一個新檔；cancelled = 教練在存檔對話框或分享選單按了取消。 */
export type SaveOutcome = 'saved' | 'shared' | 'downloaded' | 'cancelled';

/** 一支流程一個：記得上次存到哪個檔，下次存回同一個。開別的流程時換一個新的。 */
export interface FileSaver {
	save(bytes: Uint8Array, fileName: string): Promise<SaveOutcome>;
}

/**
 * 流程名 → 存檔的檔名「流程名.zip」。檔名不能用的字（\ / : * ? " < > | 和控制字元）照瀏覽器下載時的規則先換成「_」，
 * 頭尾的空白和句點拿掉，提示的檔名才跟實際存下來的一樣。
 */
export function flowFileName(flowName: string): string {
	const safe = flowName.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
	return `${safe || '流程'}.zip`;
}

const ZIP_TYPES = [{ description: '流程檔', accept: { 'application/zip': ['.zip'] } }];

/** File System Access 裡用到的那一點（TypeScript 的 lib.dom 沒有 showSaveFilePicker、showOpenFilePicker、requestPermission）。 */
interface PickerWindow {
	showSaveFilePicker(options: { suggestedName: string; types: typeof ZIP_TYPES }): Promise<FileSystemFileHandle>;
	showOpenFilePicker(options: { types: typeof ZIP_TYPES }): Promise<FileSystemFileHandle[]>;
}
interface PermissionHandle {
	requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

/** 選好的流程檔，和存回那個檔的存檔薄層。 */
export interface PickedFile {
	file: File;
	saver: FileSaver;
}

/**
 * 有 showOpenFilePicker 的瀏覽器（Chrome、Edge）用它選流程檔：拿得到檔案 handle，第一次存檔就存回同一個檔。
 * 選檔視窗按取消回 null。沒有的瀏覽器（Safari、iPad、Firefox）回 null，頁面照舊用 <input type="file">。
 */
export function browserFilePicker(): (() => Promise<PickedFile | null>) | null {
	if (typeof window === 'undefined' || !('showOpenFilePicker' in window)) return null;
	return async () => {
		try {
			const [handle] = await (window as unknown as PickerWindow).showOpenFilePicker({ types: ZIP_TYPES });
			return { file: await handle.getFile(), saver: createBrowserSaver(handle) };
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return null;
			throw e;
		}
	};
}

/** handle：開檔時拿到的檔（存回它）；沒有就第一次存檔時問存到哪。 */
export function createBrowserSaver(opened: FileSystemFileHandle | null = null): FileSaver {
	let handle = opened;
	/** 開檔拿到的 handle 只能讀：第一次存之前要寫入的權限。 */
	let askWrite = opened !== null;
	return {
		async save(bytes, fileName) {
			if (!('showSaveFilePicker' in window)) {
				const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: 'application/zip' });
				if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
					try {
						await navigator.share({ files: [file] });
						return 'shared';
					} catch (e) {
						if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
						throw e;
					}
				}
				download(bytes, fileName);
				return 'downloaded';
			}
			if (handle && askWrite) {
				askWrite = false;
				const granted = (await (handle as PermissionHandle).requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
				// 不給寫：改問存到哪
				if (granted !== 'granted') handle = null;
			}
			if (!handle) {
				try {
					handle = await (window as unknown as PickerWindow).showSaveFilePicker({
						suggestedName: fileName,
						types: ZIP_TYPES
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
