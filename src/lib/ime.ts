// 中文輸入法還在選字時按的鍵（Enter、Esc…）是給輸入法的，畫面不該拿去用。

/** 這個按鍵是不是輸入法選字時按的（Safari 選字時 isComposing 可能是 false，但 keyCode 是 229）。 */
export function composing(e: KeyboardEvent): boolean {
	return e.isComposing || e.keyCode === 229;
}
