// 流程影片用的顏色。版面（layout.ts）只寫 key，畫的時候（draw.ts）才換成色碼。

export type ColorKey =
	// 背景、文字
	| 'bg'
	| 'ink'
	| 'muted'
	// 1–8 那一排：平常、現在這拍、最後一個八拍多出來的（灰掉）
	| 'beatIdle'
	| 'beatIdleInk'
	| 'beatLit'
	| 'beatLitInk'
	| 'beatOff'
	| 'beatOffInk'
	// 拍點格子：格線、現在這拍那一欄
	| 'gridLine'
	| 'gridNow'
	// 拍點：拍子 down、up（白字）、步驟、手位
	| 'cueDown'
	| 'cueUp'
	| 'cueCountInk'
	| 'cueStepBg'
	| 'cueStepLine'
	| 'cueStepInk'
	| 'cueMotionBg'
	| 'cueMotionLine'
	| 'cueMotionInk'
	// 環節的框
	| 'phaseLine'
	// 場地（只有 draw.ts 用）：外圍、墊子、格線、接縫、中心記號
	| 'margin'
	| 'marginLine'
	| 'mat'
	| 'matLine'
	| 'matGrid'
	| 'seam'
	| 'center'
	// 圓點：底層、上層、框、標記的字（上層反白）、第 2 層的黃框、三層的橘框、被別層蓋到的虛線圈；「正面／裁判」
	| 'dotBase'
	| 'dotTop'
	| 'dotLine'
	| 'dotInk'
	| 'dotTopInk'
	| 'raised'
	| 'lv3'
	| 'covered'
	| 'front';

/**
 * 色碼，照編輯器的樣子：場地的抄 Field.svelte 的 CSS，其他抄 app.css 的變數。
 * 影片永遠用淺色的那一套，不跟著系統深色。colors.test.ts 讀原始碼比對，兩邊改了會紅。
 * 有透明度的（matGrid、center、數字的白邊）只存色，透明度寫在 draw.ts。
 */
export const VIDEO_COLORS: Record<ColorKey, string> = {
	bg: '#ffffff',
	ink: '#16213a',
	muted: '#5c677f',
	beatIdle: '#e8ecf3',
	beatIdleInk: '#5c677f',
	beatLit: '#f2542d',
	beatLitInk: '#ffffff',
	beatOff: '#f6f8fb',
	beatOffInk: '#d8dee9',
	gridLine: '#d8dee9',
	gridNow: '#fff3d1',
	cueDown: '#1f5fbf',
	cueUp: '#2b7a2f',
	cueCountInk: '#ffffff',
	cueStepBg: '#fff1e2',
	cueStepLine: '#e08a2e',
	cueStepInk: '#8a4a12',
	cueMotionBg: '#ffe3f0',
	cueMotionLine: '#d6589a',
	cueMotionInk: '#9c1d5c',
	phaseLine: '#16213a',
	margin: '#e4e8ef',
	marginLine: '#c3cad7',
	mat: '#2f66b8',
	matLine: '#1d4489',
	matGrid: '#fff',
	seam: '#12306a',
	center: '#fff',
	dotBase: '#fff',
	dotTop: '#e0664f',
	dotLine: '#16213a',
	dotInk: '#16213a',
	dotTopInk: '#fff',
	raised: '#ffd400',
	lv3: '#ff7a00',
	covered: '#16213a',
	front: '#b93a1a'
};
