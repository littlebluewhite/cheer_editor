// 流程資料和建立流程的指令。
// 欄位照規格的流程檔格式 `flow` 那一層；之後的票再加段、動作等。

import { MAX_STRIPS, MIN_STRIPS, type FieldConfig } from './field';
import type { Formation } from './formation';
import type { Member } from './members';
import { blocked, ok, type CommandResult } from './result';

export interface Flow {
	name: string;
	/** 建好之後不能換。 */
	field: FieldConfig;
	/** 名單順序 = 泳道順序。 */
	members: Member[];
	/** 第一張是流程開頭那張，一定在、不能刪。 */
	formations: Formation[];
}

export interface NewFlowInput {
	name: string;
	field: FieldConfig;
}

export function createFlow(input: NewFlowInput): CommandResult {
	const name = input.name.trim();
	if (!name) return blocked('請幫流程取名字');
	const { strips } = input.field;
	if (!Number.isInteger(strips) || strips < MIN_STRIPS || strips > MAX_STRIPS) {
		return blocked(`條數要是 ${MIN_STRIPS}–${MAX_STRIPS} 的整數`);
	}
	return ok({
		name,
		field: { ...input.field },
		members: [],
		formations: [{ id: 'f1', pos: {} }]
	});
}
