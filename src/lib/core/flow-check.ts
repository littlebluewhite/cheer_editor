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

/** 一個毛病：key 認得出「同一個毛病」（只用 id，不用會變的字），message 是給教練看的原因。 */
interface Violation {
	key: string;
	message: string;
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
export function flowProblem(flow: Flow, before: Flow = flow): string | null {
	// 開檔就擋：型別、參照、拍點、成功率設定、開頭那張站位（isFlow），段的長度。
	const broken = structureProblem(flow) ?? segmentLengthProblem(flow);
	if (broken) return broken;
	const old = new Set(violations(before).map((v) => v.key));
	return violations(flow).find((v) => !old.has(v.key))?.message ?? null;
}

/** 「讓它留著」的規則，流程裡所有的毛病。 */
function violations(flow: Flow): Violation[] {
	const out: Violation[] = [];
	const add = (key: string, message: string | null) => {
		if (message) out.push({ key, message });
	};
	const inAction = (a: Action, problem: string | null) => problem && `動作「${actionLabel(a)}」：${problem}`;
	const inFormation = (i: number, problem: string | null) => problem && `站位 ${i + 1}：${problem}`;

	// 人數上限（addMembers）。
	add('members', flow.members.length > MAX_MEMBERS ? `一支流程最多 ${MAX_MEMBERS} 人` : null);

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
			!name ? '請填任務角色名稱' : (tooLong('roleName', name) ?? (taken ? `已經有「${name}」這個任務角色了` : null))
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
	segmentSpans(flow).forEach(({ segment: s, label }) => {
		if (s.kind !== 'music') return;
		add(`bpm:${s.id}`, s.bpm >= MIN_BPM && s.bpm <= MAX_BPM ? null : `${label}：${OUT_OF_RANGE.bpm}`);
		add(`firstBeat:${s.id}`, s.firstBeatSec >= 0 ? null : `${label}：${OUT_OF_RANGE.firstBeatSec}`);
	});

	// 站位：站在場地外 1 m 以內（setPositions）；照時間排、同一拍只有一張、在段裡（insertFormation、moveFormation）。
	flow.formations.forEach((f, i) => {
		for (const [id, p] of Object.entries(f.pos)) {
			const who = flow.members.find((m) => m.id === id)?.name ?? '';
			add(`pos:${f.id}:${id}`, onField(flow.field, p) ? null : inFormation(i, `${who} ${OFF_FIELD}`));
		}
		if (i === 0) return;
		const inOrder = inGrid(flow, f as TimePosition) && formationSec(flow, f) > formationSec(flow, flow.formations[i - 1]) + EPS;
		add(`formationTime:${f.id}`, inOrder ? null : `站位 ${i + 1} 要在站位 ${i} 之後、段的時間裡`);
	});

	// 動作：時間在段裡、至少一個人（addAction、updateAction）；人不重複、任務角色在、同一個人不在兩個同時的動作裡。
	const roles = roleGlossary(flow).map((r) => r.name);
	flow.actions.forEach((a, i) => {
		add(`actionShape:${a.id}`, inAction(a, shapeProblem(flow, a)));
		const ids = a.members.map((m) => m.memberId);
		add(`twice:${a.id}`, new Set(ids).size === ids.length ? null : inAction(a, '同一個人只能放一次'));
		for (const { memberId, role } of a.members) {
			add(`role:${a.id}:${memberId}`, role === null || roles.includes(role) ? null : inAction(a, `沒有「${role}」這個任務角色`));
		}
		for (const b of flow.actions.slice(i + 1)) {
			if (!overlaps(a, b)) continue;
			for (const id of ids.filter((id) => b.members.some((m) => m.memberId === id))) {
				add(`clash:${a.id}:${b.id}:${id}`, `${memberName(flow, id)} 同一時間在「${actionLabel(a)}」和「${actionLabel(b)}」裡`);
			}
		}
	});
	return out;
}
