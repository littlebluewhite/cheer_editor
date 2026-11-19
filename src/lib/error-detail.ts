// 錯誤的原文：做影片、存影片沒成功時，對話框用小字寫出來。

/** 對話框小字寫的原文（給要回報問題的人看）：只有錯誤自己的訊息；沒有就是空的，小字不寫。 */
export function failureDetail(e: unknown): string {
	if (e instanceof Error || e instanceof DOMException) return e.message.trim();
	return typeof e === 'string' ? e.trim() : '';
}
