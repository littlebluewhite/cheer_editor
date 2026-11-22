// App 的手感（#376，情境 bridge-scenarios/current/screen.json）：跟殼說現在是哪一種畫面。
// 編輯畫面整頁不回彈；會捲的頁（首頁、使用說明、帳號）照樣回彈。殼每載入一頁都先當是會捲的頁，
// 所以只有進出編輯畫面時要說。網頁版、不會分畫面的舊殼不說。
import { host } from '#lib/host.js';

function tell(kind: 'editor' | 'page') {
	const { shell } = host();
	if (shell.inApp && shell.can('screen')) shell.send('screen', { kind }).catch(() => {});
}

/** 在元件初始化時叫：onEditor() 變成 true 時說是編輯畫面，變回 false 或元件拿掉時說是會捲的頁。 */
export function tellShellScreen(onEditor: () => boolean): void {
	// 包一層 $derived：流程每改一下都是新的物件，只有 true／false 換了才再說
	const editing = $derived(onEditor());
	$effect(() => {
		if (!editing) return;
		tell('editor');
		return () => tell('page');
	});
}
