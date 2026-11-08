// 編輯頁左右怎麼分：場地照長寬比，吃得到多寬就給多寬，剩下的寬度給右邊欄。
// 場地多高是固定的（視窗高減掉上方列和時間軸），所以先算場地要多寬，右邊欄拿剩下的。

/** 右邊欄最窄。 */
export const INSPECTOR_MIN_PX = 360;
/** 自動分的時候右邊欄最寬：再寬表單會太散，多的空白留給場地那邊。 */
export const INSPECTOR_AUTO_MAX_PX = 960;
/** 場地那一欄除了場地本身還要的寬度：左邊工具欄 236、間隔 12、左右內距各 12。 */
export const FIELD_CHROME_PX = 236 + 12 + 24;
/**
 * 場地那一欄除了場地本身還要的高度：上下的內距（各 12），和場地上面固定留給選人工具列的那一條
 * （40，跟 Field 的 .stage.band 一樣：工具列出不出現，場地都不跳、不被蓋住）。
 */
const FIELD_PAD_Y_PX = 24 + 40;
/** 場地最小多寬（不算左邊工具欄）：右邊欄拖得再寬，1024 寬的小筆電、iPad 上場地也不會被擠到看不清楚。 */
export const FIELD_MIN_W_PX = 360;
/** 自己拖的時候，場地那一欄至少留這麼寬。 */
export const FIELD_KEEP_W_PX = FIELD_CHROME_PX + FIELD_MIN_W_PX;

/**
 * 沒拖過時右邊欄多寬：場地那一欄高 fieldHostH，場地的長寬比是 aspect（寬 ÷ 高），
 * 場地要的寬度以外都給右邊欄；最窄 INSPECTOR_MIN_PX，最寬 INSPECTOR_AUTO_MAX_PX 和視窗的一半。
 */
export function autoInspectorWidth(windowW: number, fieldHostH: number, aspect: number): number {
	const fieldW = FIELD_CHROME_PX + Math.max(0, fieldHostH - FIELD_PAD_Y_PX) * aspect;
	const max = Math.min(INSPECTOR_AUTO_MAX_PX, windowW / 2);
	return Math.round(Math.max(INSPECTOR_MIN_PX, Math.min(windowW - fieldW, max)));
}

/**
 * 窄螢幕（手機、直拿的 iPad、縮小的視窗）：編輯畫面放不下，一律是檢視模式，換成手機的檢視畫面
 * （上面場地、中間播放鈕、下面八拍表這一列，docs/adr/0005-ipad-touch.md）。
 * 只看 screen：列印時紙比較窄，不能因為這樣換畫面。
 */
export const NARROW_SCREEN = 'screen and (max-width: 1023px), screen and (max-height: 599px)';
/** 觸控螢幕（iPad、手機）：主要的指標是手指。沒有 matchMedia（伺服器上）就當不是。 */
export function isTouchScreen(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** 編輯畫面至少要這麼寬、這麼高（跟 NARROW_SCREEN 一樣）。 */
const EDIT_MIN_W_PX = 1024;
const EDIT_MIN_H_PX = 600;

/**
 * 窄螢幕上為什麼不能編，寫在手機的檢視畫面「檢視模式・只能看」後面：觸控螢幕拿直的、轉成橫的就夠大 → 請轉成橫的；
 * 不然照寬或高分開寫太窄、太矮（兩個都不夠寫太小）。夠大就是 ''。不寫幾像素：看的人多半是隊員，用不到（N37）。
 */
export function viewOnlyReason(w: number, h: number, touch: boolean): string {
	const narrow = w < EDIT_MIN_W_PX;
	const short = h < EDIT_MIN_H_PX;
	if (!narrow && !short) return '';
	if (touch && h > w && h >= EDIT_MIN_W_PX && w >= EDIT_MIN_H_PX) return '請轉成橫的才能編輯';
	return `畫面太${narrow && short ? '小' : narrow ? '窄' : '矮'}`;
}

/** 自己拖的寬度夾在 INSPECTOR_MIN_PX 和「場地那一欄留 FIELD_KEEP_W_PX」之間。 */
export function clampInspectorWidth(px: number, windowW: number): number {
	return Math.round(Math.max(INSPECTOR_MIN_PX, Math.min(px, windowW - FIELD_KEEP_W_PX)));
}
