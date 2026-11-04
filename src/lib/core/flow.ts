// 流程資料和建立流程的指令。
// 欄位照規格的流程檔格式 `flow` 那一層；之後的票再加段、動作等。

import type { Action } from './actions';
import { MAX_STRIPS, MIN_STRIPS, type FieldConfig } from './field';
import type { Formation } from './formation';
import type { MarkerStyle, Member } from './members';
import { blocked, ok, type CommandResult } from './result';
import type { CustomRole } from './roles';
import type { AudioRef, Segment } from './segment';
import { DEFAULT_TIME_RULES, type TimeRules } from './time-rules';

export interface Flow {
	name: string;
	/** 建好之後不能換。 */
	field: FieldConfig;
	timeRules: TimeRules;
	/** 名單順序 = 泳道順序。 */
	members: Member[];
	/** 用到的音樂檔清單（只有參照，位元組另外放）。 */
	audio: AudioRef[];
	/** 一串緊接的段，順序就是播放順序。 */
	segments: Segment[];
	/** 照時間排。第一張是流程開頭那張（第一段的時間 0），一定在、不能刪。 */
	formations: Formation[];
	/** 這支流程自己加的任務角色（固定的 11 個不存）。 */
	customRoles: CustomRole[];
	actions: Action[];
	/** 隊員的標記用號碼還是開頭字；沒有就是號碼。 */
	markers?: MarkerStyle;
	/** 刪了也不重用的 id 已經發到第幾號，key 是 id 的字母（p：環節）；沒有就是還沒發過。 */
	lastIds?: Record<string, number>;
}

export interface NewFlowInput {
	name: string;
	field: FieldConfig;
}

const NO_NAME = '請幫流程取名字';

export function createFlow(input: NewFlowInput): CommandResult {
	const name = input.name.trim();
	if (!name) return blocked(NO_NAME);
	const { strips } = input.field;
	if (!Number.isInteger(strips) || strips < MIN_STRIPS || strips > MAX_STRIPS) {
		return blocked(`條數要是 ${MIN_STRIPS}–${MAX_STRIPS} 的整數`);
	}
	return ok({
		name,
		field: { ...input.field },
		timeRules: { ...DEFAULT_TIME_RULES },
		members: [],
		audio: [],
		segments: [],
		formations: [{ id: 'f1', segmentId: null, at: 0, pos: {} }],
		customRoles: [],
		actions: []
	});
}

/** 隊員的名字；找不到這個人是空字串。 */
export function memberName(flow: Flow, id: string): string {
	return flow.members.find((m) => m.id === id)?.name ?? '';
}

/** 流程設定：改流程名字。存檔的檔名跟著變。 */
export function renameFlow(flow: Flow, name: string): CommandResult {
	const trimmed = name.trim();
	if (!trimmed) return blocked(NO_NAME);
	return ok({ ...flow, name: trimmed });
}
