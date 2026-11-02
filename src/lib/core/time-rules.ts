// 時間規則警告：只提醒，不擋。數字和開關存在每支流程裡。

import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { segmentSpans } from './time';

export interface TimeRules {
	on: boolean;
	minChantSec: number;
	maxMusicSec: number;
	maxTotalSec: number;
}

export const DEFAULT_TIME_RULES: TimeRules = {
	on: true,
	minChantSec: 30,
	maxMusicSec: 120,
	maxTotalSec: 180
};

/** 剛好等於限制不算超過；這點誤差是浮點數算秒數留下的。 */
const EPS = 1e-6;

/** 流程設定：改規則警告的開關和三個數字。 */
export function updateTimeRules(flow: Flow, patch: Partial<TimeRules>): CommandResult {
	const timeRules = { ...flow.timeRules, ...patch };
	const { minChantSec, maxMusicSec, maxTotalSec } = timeRules;
	if (![minChantSec, maxMusicSec, maxTotalSec].every((n) => Number.isFinite(n) && n >= 0)) {
		return blocked('秒數要是 0 以上的數字');
	}
	return ok({ ...flow, timeRules });
}

/** 給上方列的提醒文字；關掉時是空的。 */
export function timeRuleWarnings(flow: Flow): string[] {
	const rules = flow.timeRules;
	if (!rules.on) return [];
	let chant = 0;
	let music = 0;
	for (const span of segmentSpans(flow)) {
		if (span.segment.kind === 'music') music += span.durationSec;
		else chant += span.durationSec;
	}
	const total = chant + music;
	const warnings: string[] = [];
	if (chant < rules.minChantSec - EPS) {
		warnings.push(`口號段共 ${chant.toFixed(1)} 秒，少於 ${rules.minChantSec} 秒`);
	}
	if (music > rules.maxMusicSec + EPS) {
		warnings.push(`音樂段共 ${music.toFixed(1)} 秒，超過 ${rules.maxMusicSec} 秒`);
	}
	if (total > rules.maxTotalSec + EPS) {
		warnings.push(`整支流程共 ${total.toFixed(1)} 秒，超過 ${rules.maxTotalSec} 秒`);
	}
	return warnings;
}
