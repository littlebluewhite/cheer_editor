// 流程資料和建立流程的指令。
// 欄位照規格的流程檔格式 `flow` 那一層；之後的票再加隊員、段、動作、站位等。

import { MAX_STRIPS, MIN_STRIPS, type FieldConfig } from './field';
import { blocked, ok, type CommandResult } from './result';

export interface Flow {
	name: string;
	/** 建好之後不能換。 */
	field: FieldConfig;
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
	return ok({ name, field: { ...input.field } });
}
