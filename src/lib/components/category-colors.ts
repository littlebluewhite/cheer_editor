// 大類的顏色（泳道色條、表單）。照主畫面原型 A。
import type { ActionCategory } from '#lib/core';

export const CATEGORY_COLORS: Record<ActionCategory, string> = {
	stunt: '#d9603b',
	pyramid: '#7d55c7',
	toss: '#c28e0e',
	tumbling: '#2e8b57',
	jump: '#1f84d6',
	dance: '#d1468c',
	other: '#6b7280'
};
