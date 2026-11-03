// 編輯頁左右怎麼分：場地照長寬比，吃得到多寬就給多寬，剩下的寬度給右邊欄。
// 場地多高是固定的（視窗高減掉上方列和時間軸），所以先算場地要多寬，右邊欄拿剩下的。

/** 右邊欄最窄。 */
export const INSPECTOR_MIN_PX = 360;
/** 自動分的時候右邊欄最寬：再寬表單會太散，多的空白留給場地那邊。 */
export const INSPECTOR_AUTO_MAX_PX = 960;
/** 場地那一欄除了場地本身還要的寬度：左邊工具欄 236、間隔 12、左右內距各 12。 */
export const FIELD_CHROME_PX = 236 + 12 + 24;
/** 場地那一欄上下的內距（各 12）。 */
const FIELD_PAD_Y_PX = 24;
/** 自己拖的時候，場地那一欄至少留這麼寬。 */
export const FIELD_KEEP_W_PX = 560;

/**
 * 沒拖過時右邊欄多寬：場地那一欄高 fieldHostH，場地的長寬比是 aspect（寬 ÷ 高），
 * 場地要的寬度以外都給右邊欄；最窄 INSPECTOR_MIN_PX，最寬 INSPECTOR_AUTO_MAX_PX 和視窗的一半。
 */
export function autoInspectorWidth(windowW: number, fieldHostH: number, aspect: number): number {
	const fieldW = FIELD_CHROME_PX + Math.max(0, fieldHostH - FIELD_PAD_Y_PX) * aspect;
	const max = Math.min(INSPECTOR_AUTO_MAX_PX, windowW / 2);
	return Math.round(Math.max(INSPECTOR_MIN_PX, Math.min(windowW - fieldW, max)));
}

/** 自己拖的寬度夾在 INSPECTOR_MIN_PX 和「場地那一欄留 FIELD_KEEP_W_PX」之間。 */
export function clampInspectorWidth(px: number, windowW: number): number {
	return Math.round(Math.max(INSPECTOR_MIN_PX, Math.min(px, windowW - FIELD_KEEP_W_PX)));
}
