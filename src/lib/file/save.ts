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
	/**
	 * 還沒有要存回的檔就先問存到哪（Chrome、Edge 的存檔對話框），之後 save 存到那裡；回傳 false 是按了取消。
	 * 存檔前還要等伺服器的（下載雲端流程）先問：等太久按下去的那一下就過期了，Chrome 不讓跳存檔對話框。沒有是不用先問。
	 */
	chooseFile?(fileName: string): Promise<boolean>;
	/** 存回的那個檔叫什麼（Chrome、Edge：開檔拿到的、存檔對話框選的，教練可能改過名字）；沒有就是存檔時給的檔名。 */
	readonly fileName?: string;
	/** 跟另一個存到同一個檔（Chrome、Edge：同一個資料夾的同一個檔）；沒有是分不出來。 */
	sameFile?(other: FileSaver): Promise<boolean>;
	/** 觸控螢幕（手機、平板）：下載新檔時不叫教練改用 Chrome、Edge（那上面也不能存回原檔）。 */
	readonly touch?: boolean;
}

/**
 * 流程名 → 存檔的檔名「流程名.zip」。檔名不能用的字（\ / : * ? " < > | 和控制字元）照瀏覽器下載時的規則先換成「_」，
 * 頭尾的空白和句點拿掉，提示的檔名才跟實際存下來的一樣。
 */
export function flowFileName(flowName: string): string {
	return `${safeFileBase(flowName, '流程')}.zip`;
}

/** 流程名 → 檔名不含副檔名的那段：不能用的字換成「_」，頭尾空白和句點拿掉，空的用 fallback。 */
export function safeFileBase(name: string, fallback: string): string {
	const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
	return safe || fallback;
}

/** 流程影片的檔名「流程名.mp4」。 */
export function videoFileName(flowName: string): string {
	return `${safeFileBase(flowName, '流程')}.mp4`;
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

/** 瀏覽器存檔的現在存回哪個檔（sameFile 比兩個存檔的）。 */
const handles = new WeakMap<FileSaver, () => FileSystemFileHandle | null>();

/** handle：開檔時拿到的檔（存回它）；沒有就第一次存檔時問存到哪。 */
export function createBrowserSaver(opened: FileSystemFileHandle | null = null): FileSaver {
	let handle = opened;
	/** 開檔拿到的 handle 只能讀：第一次存之前要寫入的權限。 */
	let askWrite = opened !== null;
	/** 問存到哪；按了取消回 false。 */
	async function pick(fileName: string): Promise<boolean> {
		try {
			handle = await (window as unknown as PickerWindow).showSaveFilePicker({ suggestedName: fileName, types: ZIP_TYPES });
			return true;
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return false;
			throw e;
		}
	}
	const saver: FileSaver = {
		get fileName() {
			return handle?.name;
		},
		async sameFile(other) {
			const theirs = handles.get(other)?.();
			return !!handle && !!theirs && handle.isSameEntry(theirs);
		},
		touch: matchMedia('(pointer: coarse)').matches,
		async chooseFile(fileName) {
			return handle || !('showSaveFilePicker' in window) ? true : pick(fileName);
		},
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
			if (!handle && !(await pick(fileName))) return 'cancelled';
			const writable = await handle!.createWritable();
			await writable.write(bytes as Uint8Array<ArrayBuffer>);
			await writable.close();
			return 'saved';
		}
	};
	handles.set(saver, () => handle);
	return saver;
}

const MP4_TYPES = [{ description: '流程影片', accept: { 'video/mp4': ['.mp4'] } }];

/**
 * 存流程影片：跟流程檔的存檔是兩套，不記 handle、不碰流程檔記著的那個檔，每次都問存到哪。
 * 沒有 showSaveFilePicker 的瀏覽器直接下載（影片只在 Chrome、Edge 輸出，這是備用）。
 */
export async function saveVideo(bytes: Uint8Array, fileName: string): Promise<SaveOutcome> {
	if (!('showSaveFilePicker' in window)) {
		download(bytes, fileName, 'video/mp4');
		return 'downloaded';
	}
	try {
		const handle = await (
			window as unknown as { showSaveFilePicker(o: { suggestedName: string; types: typeof MP4_TYPES }): Promise<FileSystemFileHandle> }
		).showSaveFilePicker({ suggestedName: fileName, types: MP4_TYPES });
		const writable = await handle.createWritable();
		await writable.write(bytes as Uint8Array<ArrayBuffer>);
		await writable.close();
		return 'saved';
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
		throw e;
	}
}

/** 影片沒存成的原因：瀏覽器的訊息是英文，換成白話（原文對話框另外用小字寫）。 */
export function saveFailureReason(e: unknown): string {
	const name = typeof e === 'object' && e !== null && 'name' in e ? String(e.name) : '';
	if (name === 'NotAllowedError' || name === 'SecurityError') return '瀏覽器不讓存，再按一次「存檔」';
	if (name === 'QuotaExceededError') return '電腦的空間不夠，清出空間再存一次';
	if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') return '檔案被別的程式打開了，關掉它或換個檔名再存一次';
	return '存檔時出了問題，再按一次「存檔」';
}

function download(bytes: Uint8Array, fileName: string, type = 'application/zip') {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	// 等瀏覽器開始下載再放掉。
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
