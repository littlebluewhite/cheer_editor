// 「有沒有還沒存的修改」：頁面寫，src/hooks.client.ts 讀（有就不讓新版 service worker 自動重新載入）。

let unsaved = false;

export function setUnsavedChanges(value: boolean): void {
	unsaved = value;
}

export function hasUnsavedChanges(): boolean {
	return unsaved;
}
