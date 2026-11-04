// 可以挑的顏色：動作的辨識色、環節的顏色。畫面元件也從這裡拿（核心不能 import 畫面元件）。

/** 動作的辨識色可以挑的顏色：色條上是白字，每個對白字的對比都在 4.5 以上。 */
export const ACTION_COLORS: { value: string; label: string }[] = [
	{ value: '#c62828', label: '紅' },
	{ value: '#c24400', label: '橘' },
	{ value: '#8d6200', label: '金' },
	{ value: '#2e7d32', label: '綠' },
	{ value: '#00796b', label: '青' },
	{ value: '#1565c0', label: '藍' },
	{ value: '#3949ab', label: '靛' },
	{ value: '#7b1fa2', label: '紫' },
	{ value: '#ad1457', label: '粉' }
];

/** 環節可以挑的顏色：動作辨識色那 9 色，加上石板灰。 */
export const PHASE_COLORS: { value: string; label: string }[] = [
	...ACTION_COLORS,
	{ value: '#475569', label: '石板灰' }
];

/** 組的顏色（場上的組號小圓、分組浮動列、人員清單的組標籤），照組號輪流用；上面是白字，對白字的對比都在 4.5 以上。 */
export const SQUAD_COLORS = ['#1d4ed8', '#be185d', '#047857', '#b45309', '#6d28d9', '#0e7490', '#b91c1c', '#4d7c0f'];
export const squadColor = (squad: number) => SQUAD_COLORS[(squad - 1) % SQUAD_COLORS.length];
/** 沒分組的人：灰色「?」。 */
export const NO_SQUAD_COLOR = '#6b7280';
