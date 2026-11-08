// 時間規則警告：只提醒，不擋。數字和開關存在每支流程裡。

import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { clockText, EPS, segmentSpans } from './time';

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

/**
 * 流程設定：改規則警告的開關和三個數字。秒數要大於 0；口號段最少要比整支最多少；音樂段最多不能超過整支最多。
 * 只檢查這次改到的數字：舊檔存著 0 或互相矛盾的值照留，改開關、改不相干的那一格不會被它擋。
 */
export function updateTimeRules(flow: Flow, patch: Partial<TimeRules>): CommandResult {
	const timeRules = { ...flow.timeRules, ...patch };
	const { minChantSec, maxMusicSec, maxTotalSec } = timeRules;
	const changed = (...keys: (keyof TimeRules)[]) => keys.some((k) => k in patch);
	const seconds = (['minChantSec', 'maxMusicSec', 'maxTotalSec'] as const).filter((k) => changed(k));
	if (!seconds.every((k) => Number.isFinite(timeRules[k]) && timeRules[k] > 0)) return blocked('秒數要大於 0');
	if (changed('minChantSec', 'maxTotalSec') && minChantSec >= maxTotalSec - EPS) {
		return blocked('「口號段加起來最少」要比「整支流程最多」少');
	}
	if (changed('maxMusicSec', 'maxTotalSec') && maxMusicSec > maxTotalSec + EPS) {
		return blocked('「音樂段加起來最多」不能超過「整支流程最多」');
	}
	return ok({ ...flow, timeRules });
}

/** 一條規則警告：小標題、內容、是哪一個數字的規則（點警告時帶到那一格）。 */
export interface TimeRuleWarning {
	title: string;
	text: string;
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
		warnings.push({ title: '還沒有口號段', text: `口號段加起來最少要 ${clockText(rules.minChantSec)}`, rule: 'minChantSec' });
	} else if (chant < rules.minChantSec - EPS) {
		warnings.push({ title: '口號段太短', text: `口號段共 ${clockText(chant)}，少於 ${clockText(rules.minChantSec)}`, rule: 'minChantSec' });
	}
	if (music > rules.maxMusicSec + EPS) {
		warnings.push({ title: '音樂段太長', text: `音樂段共 ${clockText(music)}，超過 ${clockText(rules.maxMusicSec)}`, rule: 'maxMusicSec' });
	}
	if (total > rules.maxTotalSec + EPS) {
		warnings.push({ title: '整支流程太長', text: `整支流程共 ${clockText(total)}，超過 ${clockText(rules.maxTotalSec)}`, rule: 'maxTotalSec' });
	}
	return warnings;
}
