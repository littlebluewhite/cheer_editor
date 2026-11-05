// 「有沒有沒存的東西」：頁面放進編輯器 module 的問法，src/hooks.client.ts 讀（有就不讓新版 service worker 自動重新載入）。

let check = (): boolean => false;

export function setUnsavedCheck(hasUnsaved: () => boolean): void {
	check = hasUnsaved;
}

export function hasUnsavedChanges(): boolean {
	return check();
}
