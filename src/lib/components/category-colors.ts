// 大類的顏色（泳道色條、表單）。照主畫面原型 A。
import type { Action, ActionCategory } from '#lib/core';

export const CATEGORY_COLORS: Record<ActionCategory, string> = {
	stunt: '#d9603b',
	pyramid: '#7d55c7',
	toss: '#c28e0e',
	tumbling: '#2e8b57',
	jump: '#1f84d6',
	dance: '#d1468c',
	other: '#6b7280'
};

/** 辨識色可以挑的顏色：色條上是白字，每個對白字的對比都在 4.5 以上。 */
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

/** 動作在畫面上的顏色：有辨識色用辨識色，沒有就用大類的顏色。 */
export function actionColor(action: Pick<Action, 'category' | 'color'>): string {
	return action.color ?? CATEGORY_COLORS[action.category];
}
