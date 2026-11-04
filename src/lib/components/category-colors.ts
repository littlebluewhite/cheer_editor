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

/** 辨識色可以挑的顏色（在流程核心裡，環節的顏色也照這個）。 */
export { ACTION_COLORS } from '#lib/core';

/** 動作在畫面上的顏色：有辨識色用辨識色，沒有就用大類的顏色。 */
export function actionColor(action: Pick<Action, 'category' | 'color'>): string {
	return action.color ?? CATEGORY_COLORS[action.category];
}
