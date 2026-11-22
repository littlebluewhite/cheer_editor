// 整份流程檢查（ADR 0014）：復原、重做、傳上雲端時，檢查整支流程合不合規則。
// 一般的一步不跑：指令自己檢查過，這裡寫得比指令嚴，一般的步會莫名被退回。

import { actionWhy, type Action } from './action-types';
import { bookmarksOf, nameProblem, sameBookmarks } from './bookmarks';
import { overlaps, shapeProblem } from './actions';
import { flowNameProblem, memberName, stripsProblem, type Flow } from './flow';
import { segmentLengthProblem, structureProblem } from './flow-file';
import { formationSec, inGrid, OFF_FIELD, onField } from './formation';
import { MAX_MEMBERS, memberNameProblem } from './members';
import { roleGlossary, roleWhy } from './roles';
import { MAX_BPM, MIN_BPM, OUT_OF_RANGE } from './segment';
import { tooLong } from './text-length';
import { EPS, labelWhy, segmentSpans, type TimePosition } from './time';
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
	const inAction = (a: Action, problem: string | Why | null): Why | null =>
		problem ? { code: 'flow_check_in_action', action: actionWhy(a), reason: problem } : null;
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
				? { code: 'roles_no_name' }
				: (tooLong('roleName', name) ?? (taken ? { code: 'roles_name_taken', name } : null))
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
	segmentSpans(flow).forEach((span) => {
		const s = span.segment;
		if (s.kind !== 'music') return;
		const inSegment = (reason: Why): Why => ({ code: 'flow_check_in_segment', segment: labelWhy(span), reason });
		add(`bpm:${s.id}`, s.bpm >= MIN_BPM && s.bpm <= MAX_BPM ? null : inSegment(OUT_OF_RANGE.bpm));
		add(`firstBeat:${s.id}`, s.firstBeatSec >= 0 ? null : inSegment(OUT_OF_RANGE.firstBeatSec));
	});

	// 站位：站在場地外 1 m 以內（setPositions）；照時間排、同一拍只有一張、在段裡（insertFormation、moveFormation）。
	// 鍵不看清單的位置（ADR 0020）：排了站位，同一個毛病還是同一個鍵，排序本身不算新的毛病。
	flow.formations.forEach((f, i) => {
		for (const [id, p] of Object.entries(f.pos)) {
			const who = flow.members.find((m) => m.id === id)?.name ?? '';
			const off: Why = { code: 'flow_check_off_field', member: who, reason: OFF_FIELD };
			add(`pos:${f.id}:${id}`, onField(flow.field, p) ? null : inFormation(i, off));
		}
	});
	// 沒照時間排：整支流程一個鍵（第一張比前一張早的那張）。
	const early = flow.formations.findIndex((f, i) => i > 0 && formationSec(flow, f) < formationSec(flow, flow.formations[i - 1]));
	add('formationOrder', early === -1 ? null : { code: 'flow_check_formation_order', n: early + 1, before: early });
	// 同一拍兩張以上：一組一個鍵，照那幾張的 id（照 id 排），插拍、改段讓那一拍變了還是同一個鍵；
	// 多一張加進來是新的鍵。原因說第二張是跟哪一張同一拍。
	const beats = new Map<string, number[]>();
	flow.formations.forEach((f, i) => {
		const beat = `${f.segmentId}:${f.at}`;
		beats.set(beat, [...(beats.get(beat) ?? []), i]);
	});
	for (const group of beats.values()) {
		if (group.length < 2) continue;
		const ids = group.map((i) => flow.formations[i].id).sort();
		add(`formationBeat:${ids.join(':')}`, { code: 'flow_check_formation_same_beat', n: group[1] + 1, other: group[0] + 1 });
	}
	// 不在段裡：照那一張（開頭那張不看）。
	flow.formations.forEach((f, i) => {
		if (i > 0) add(`formationGrid:${f.id}`, inGrid(flow, f as TimePosition) ? null : inFormation(i, { code: 'flow_check_formation_off_grid' }));
	});

	// 動作：時間在段裡、至少一個人（addAction、updateAction）；人不重複、任務角色在、同一個人不在兩個同時的動作裡。
	const roles = roleGlossary(flow).map((r) => r.name);
	flow.actions.forEach((a, i) => {
		add(`actionShape:${a.id}`, inAction(a, shapeProblem(flow, a)));
		const ids = a.members.map((m) => m.memberId);
		add(`twice:${a.id}`, new Set(ids).size === ids.length ? null : inAction(a, { code: 'flow_check_twice' }));
		for (const { memberId, role } of a.members) {
			const unknown: Why | null = role === null || roles.includes(role) ? null : { code: 'flow_check_no_role', role: roleWhy(role) };
			add(`role:${a.id}:${memberId}`, inAction(a, unknown));
		}
		for (const b of flow.actions.slice(i + 1)) {
			if (!overlaps(a, b)) continue;
			for (const id of ids.filter((id) => b.members.some((m) => m.memberId === id))) {
				const clash: Why = { code: 'flow_check_clash', member: memberName(flow, id), first: actionWhy(a), second: actionWhy(b) };
				add(`clash:${a.id}:${b.id}:${id}`, clash);
			}
		}
	});

	// 書籤：名字（addBookmark、renameBookmark）；同一個地方只有一個書籤（addBookmark、insertBeats）。
	// 位置在流程裡、B 在 A 後面、id 不重複一律擋（structureProblem；開檔時先拿掉放不下的、說出來，readFlowFile）。
	for (const b of bookmarksOf(flow)) {
		const problem = nameProblem(b.name.trim());
		add(`bookmarkName:${b.id}`, problem && { code: 'flow_check_bookmark_name', name: b.name, reason: problem });
	}
	for (const [x, y] of sameBookmarks(flow)) {
		add(`bookmarkSame:${x.id}:${y.id}`, { code: 'flow_check_same_bookmark', first: x.name, second: y.name });
	}
	return out;
}
