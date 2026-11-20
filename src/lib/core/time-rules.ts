// 時間規則警告：只提醒，不擋。數字和開關存在每支流程裡。

import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { clockText, EPS, segmentSpans } from './time';
import type { Why } from './why';

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

/** 時間規則的數字不合時說的話。 */
export const TIME_RULE_PROBLEMS = {
	positive: { code: 'time_rules_positive' },
	chant: { code: 'time_rules_chant' },
	music: { code: 'time_rules_music' }
} satisfies Record<string, Why>;

/**
 * 流程設定：改規則警告的開關和三個數字。秒數要大於 0；口號段最少要比整支最多少；音樂段最多不能超過整支最多。
 * 只檢查這次改到的數字：舊檔存著 0 或互相矛盾的值照留，改開關、改不相干的那一格不會被它擋。
 */
export function updateTimeRules(flow: Flow, patch: Partial<TimeRules>): CommandResult {
	const timeRules = { ...flow.timeRules, ...patch };
	const { minChantSec, maxMusicSec, maxTotalSec } = timeRules;
	const changed = (...keys: (keyof TimeRules)[]) => keys.some((k) => k in patch);
	const seconds = (['minChantSec', 'maxMusicSec', 'maxTotalSec'] as const).filter((k) => changed(k));
	if (!seconds.every((k) => Number.isFinite(timeRules[k]) && timeRules[k] > 0)) return blocked(TIME_RULE_PROBLEMS.positive);
	if (changed('minChantSec', 'maxTotalSec') && minChantSec >= maxTotalSec - EPS) {
		return blocked(TIME_RULE_PROBLEMS.chant);
	}
	if (changed('maxMusicSec', 'maxTotalSec') && maxMusicSec > maxTotalSec + EPS) {
		return blocked(TIME_RULE_PROBLEMS.music);
	}
	return ok({ ...flow, timeRules });
}

/** 一條規則警告：小標題、內容（畫面照語言寫）、是哪一個數字的規則（點警告時帶到那一格）。 */
export interface TimeRuleWarning {
	title: Why;
	text: Why;
	rule: 'minChantSec' | 'maxMusicSec' | 'maxTotalSec';
}

/** 左邊欄的規則警告，一條一個；關掉時、還沒有任何段時是空的。還沒有口號段時寫法中性（不說「少於」）。 */
export function timeRuleWarnings(flow: Flow): TimeRuleWarning[] {
	const rules = flow.timeRules;
	if (!rules.on || flow.segments.length === 0) return [];
	let chant = 0;
	let music = 0;
	for (const span of segmentSpans(flow)) {
		if (span.segment.kind === 'music') music += span.durationSec;
		else chant += span.durationSec;
	}
	const total = chant + music;
	const warnings: TimeRuleWarning[] = [];
	if (!flow.segments.some((s) => s.kind === 'chant')) {
		warnings.push({
			title: { code: 'time_rules_no_chant' },
			text: { code: 'time_rules_no_chant_text', min: clockText(rules.minChantSec) },
			rule: 'minChantSec'
		});
	} else if (chant < rules.minChantSec - EPS) {
		warnings.push({
			title: { code: 'time_rules_chant_short' },
			text: { code: 'time_rules_chant_short_text', total: clockText(chant), min: clockText(rules.minChantSec) },
			rule: 'minChantSec'
		});
	}
	if (music > rules.maxMusicSec + EPS) {
		warnings.push({
			title: { code: 'time_rules_music_long' },
			text: { code: 'time_rules_music_long_text', total: clockText(music), max: clockText(rules.maxMusicSec) },
			rule: 'maxMusicSec'
		});
	}
	if (total > rules.maxTotalSec + EPS) {
		warnings.push({
			title: { code: 'time_rules_total_long' },
			text: { code: 'time_rules_total_long_text', total: clockText(total), max: clockText(rules.maxTotalSec) },
			rule: 'maxTotalSec'
		});
	}
	return warnings;
}
