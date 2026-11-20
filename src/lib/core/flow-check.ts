// 整份流程檢查（ADR 0014）：復原、重做、傳上雲端時，檢查整支流程合不合規則。
// 一般的一步不跑：指令自己檢查過，這裡寫得比指令嚴，一般的步會莫名被退回。

import { actionLabel, type Action } from './action-types';
import { overlaps, shapeProblem } from './actions';
import { flowNameProblem, memberName, stripsProblem, type Flow } from './flow';
import { segmentLengthProblem, structureProblem } from './flow-file';
import { formationSec, inGrid, OFF_FIELD, onField } from './formation';
import { MAX_MEMBERS, memberNameProblem } from './members';
import { roleGlossary } from './roles';
import { MAX_BPM, MIN_BPM, OUT_OF_RANGE } from './segment';
import { tooLong } from './text-length';
import { EPS, segmentSpans, type TimePosition } from './time';
import { TIME_RULE_PROBLEMS } from './time-rules';
import type { Why } from './why';

/**
 * 一個毛病：key 認得出「同一個毛病」（只用 id，不用會變的字），message 是給教練看的原因
 * （代號；別的核心檔還沒改成代號的原因是中文）。
 */
interface Violation {
	key: string;
	message: string | Why;
}

/**
 * 整份流程檢查：不合規則時回給教練看的原因（第一個），合規則是 null。
 * before 是這一步之前的樣子（復原、重做時是伺服器現在的樣子）；傳上雲端沒有之前，不給。
 *
 * 每條規則是下面兩種之一（CODING_STANDARDS「新上限要管到已經存在的資料」）：
 * - 開檔就擋：readFlowFile 也擋的，一定檢查。
 * - 讓它留著：開檔不擋，舊檔可能已經不合。before 裡已經有的同一個毛病不算，只擋這一步新出現的；
 *   沒給 before 就都不算，所以開得了的流程檔一定傳得上雲端。
 */
export function flowProblem(flow: Flow, before: Flow = flow): string | Why | null {
	// 開檔就擋：型別、參照、拍點、成功率設定、開頭那張站位（isFlow），段的長度。
	const broken = structureProblem(flow) ?? segmentLengthProblem(flow);
	if (broken) return broken;
	const old = new Set(violations(before).map((v) => v.key));
	return violations(flow).find((v) => !old.has(v.key))?.message ?? null;
}

/** 「讓它留著」的規則，流程裡所有的毛病。 */
function violations(flow: Flow): Violation[] {
	const out: Violation[] = [];
	const add = (key: string, message: string | Why | null) => {
		if (message) out.push({ key, message });
	};
	// 動作名稱照 actionLabel（大類是中文，之後整個畫面翻譯時再改）
	const inAction = (a: Action, problem: string | Why | null): Why | null =>
		problem ? { code: 'flow_check_in_action', action: actionLabel(a), reason: problem } : null;
	const inFormation = (i: number, problem: string | Why | null): Why | null =>
		problem ? { code: 'flow_check_in_formation', n: i + 1, reason: problem } : null;

	// 人數上限（addMembers）。
	add('members', flow.members.length > MAX_MEMBERS ? { code: 'flow_check_max_members', max: MAX_MEMBERS } : null);

	// 名字：空的、太長（每個改名字的指令）。
	add('flowName', flowNameProblem(flow.name));
	for (const m of flow.members) add(`memberName:${m.id}`, memberNameProblem(m.name.trim()));
	for (const a of flow.actions) {
		add(`actionName:${a.id}`, inAction(a, tooLong('actionName', a.name)));
		add(`note:${a.id}`, inAction(a, tooLong('note', a.note)));
	}
	flow.formations.forEach((f, i) => add(`formationName:${f.id}`, inFormation(i, f.name ? tooLong('formationName', f.name) : null)));
	for (const r of flow.customRoles) {
		const name = r.name.trim();
		const taken = roleGlossary(flow).filter((x) => x.name === name).length > 1;
		add(
			`roleName:${r.id}`,
			!name
				? { code: 'flow_check_no_role_name' }
				: (tooLong('roleName', name) ?? (taken ? { code: 'flow_check_role_taken', role: name } : null))
		);
	}

	// 場地（adjustField）、時間規則（updateTimeRules）。
	add('strips', stripsProblem(flow.field.strips));
	const { minChantSec, maxMusicSec, maxTotalSec } = flow.timeRules;
	for (const k of ['minChantSec', 'maxMusicSec', 'maxTotalSec'] as const) {
		add(`timeRules:${k}`, flow.timeRules[k] > 0 ? null : TIME_RULE_PROBLEMS.positive);
	}
	add('timeRules:chant', minChantSec >= maxTotalSec - EPS ? TIME_RULE_PROBLEMS.chant : null);
	add('timeRules:music', maxMusicSec > maxTotalSec + EPS ? TIME_RULE_PROBLEMS.music : null);

	// 段的 BPM、第一拍（updateSegment）。長度是開檔就擋。
	// 段的名字（「音樂 1」）照 segmentSpans 給的中文，等 time.ts 有代號再換
	segmentSpans(flow).forEach(({ segment: s, label }) => {
		if (s.kind !== 'music') return;
		const inSegment = (reason: string): Why => ({ code: 'flow_check_in_segment', segment: label, reason });
		add(`bpm:${s.id}`, s.bpm >= MIN_BPM && s.bpm <= MAX_BPM ? null : inSegment(OUT_OF_RANGE.bpm));
		add(`firstBeat:${s.id}`, s.firstBeatSec >= 0 ? null : inSegment(OUT_OF_RANGE.firstBeatSec));
	});

	// 站位：站在場地外 1 m 以內（setPositions）；照時間排、同一拍只有一張、在段裡（insertFormation、moveFormation）。
	flow.formations.forEach((f, i) => {
		for (const [id, p] of Object.entries(f.pos)) {
			const who = flow.members.find((m) => m.id === id)?.name ?? '';
			const off: Why = { code: 'flow_check_off_field', member: who, reason: OFF_FIELD };
			add(`pos:${f.id}:${id}`, onField(flow.field, p) ? null : inFormation(i, off));
		}
		if (i === 0) return;
		const inOrder = inGrid(flow, f as TimePosition) && formationSec(flow, f) > formationSec(flow, flow.formations[i - 1]) + EPS;
		add(`formationTime:${f.id}`, inOrder ? null : { code: 'flow_check_formation_order', n: i + 1, before: i });
	});

	// 動作：時間在段裡、至少一個人（addAction、updateAction）；人不重複、任務角色在、同一個人不在兩個同時的動作裡。
	const roles = roleGlossary(flow).map((r) => r.name);
	flow.actions.forEach((a, i) => {
		add(`actionShape:${a.id}`, inAction(a, shapeProblem(flow, a)));
		const ids = a.members.map((m) => m.memberId);
		add(`twice:${a.id}`, new Set(ids).size === ids.length ? null : inAction(a, { code: 'flow_check_twice' }));
		for (const { memberId, role } of a.members) {
			const unknown: Why | null = role === null || roles.includes(role) ? null : { code: 'flow_check_no_role', role };
			add(`role:${a.id}:${memberId}`, inAction(a, unknown));
		}
		for (const b of flow.actions.slice(i + 1)) {
			if (!overlaps(a, b)) continue;
			for (const id of ids.filter((id) => b.members.some((m) => m.memberId === id))) {
				const clash: Why = { code: 'flow_check_clash', member: memberName(flow, id), first: actionLabel(a), second: actionLabel(b) };
				add(`clash:${a.id}:${b.id}:${id}`, clash);
			}
		}
	});
	return out;
}
