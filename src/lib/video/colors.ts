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
	| 'phaseLine';
