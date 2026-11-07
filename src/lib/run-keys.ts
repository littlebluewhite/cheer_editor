// 一起記全上（#262）的「組」：照組號跨動作一起選（第 2 組是每個動作的第 2 組），騰翻、跳躍每個人一個。
// 伺服器不看裡面，只拿來比誰拿著哪一組：組號是「n:2」，騰翻、跳躍的人是「m:隊員 id」。

import { memberName, perPerson, squadNumber, type Action, type Flow } from '#lib/core';

/** 一個動作的一欄（who 是組 id，騰翻、跳躍是隊員 id）是哪一組。 */
export function runKey(action: Action, who: string): string {
	return perPerson(action.category) ? `m:${who}` : `n:${squadNumber(action, who)}`;
}

/** 組的名字：「第 2 組」，騰翻、跳躍是那個人的名字。 */
export function runKeyLabel(flow: Flow, key: string): string {
	return key.startsWith('n:') ? `第 ${key.slice(2)} 組` : memberName(flow, key.slice(2));
}

/** 要記的動作裡的每一組：組號由小到大，再來騰翻、跳躍的人（照名單順序）。 */
export function runKeys(flow: Flow, columns: { action: Action; whos: { who: string }[] }[]): string[] {
	const keys = new Set(columns.flatMap(({ action, whos }) => whos.map(({ who }) => runKey(action, who))));
	const squads = [...keys].filter((k) => k.startsWith('n:')).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
	const people = flow.members.map((m) => `m:${m.id}`).filter((k) => keys.has(k));
	return [...squads, ...people];
}

/** 有人在記的一次全上：伺服器說的（id、日期、開的時間）。 */
type LiveRun = { id: string; date: string; startedAt: number };

/**
 * 這次全上是那天第幾次：照開的時間排（舊檔沒有開的時間的排在前面），存好的、還有人在記的都算。
 * 沒給 run 是那天再開一次是第幾次。
 */
export function runNumber(flow: Flow, live: LiveRun[], date: string, run?: LiveRun): number {
	const starts = new Map<string, number | undefined>();
	for (const a of flow.actions) {
		for (const r of a.successRate?.records ?? []) {
			if (r.date === date && r.runThroughId !== undefined) starts.set(r.runThroughId, r.runThroughStartedAt);
		}
	}
	for (const r of live) if (r.date === date) starts.set(r.id, r.startedAt);
	if (!run) return starts.size + 1;
	const before = [...starts].filter(([id, at]) => id !== run.id && (at === undefined || at < run.startedAt));
	return before.length + 1;
}

/** 開的時間寫成「9:05」（手機的時間）。 */
export function startClock(ms: number): string {
	const at = new Date(ms);
	return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
}
