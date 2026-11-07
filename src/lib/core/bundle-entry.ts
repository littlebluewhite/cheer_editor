// 打包流程核心的入口（scripts/core-bundle.mjs）：伺服器用 QuickJS 跑這一包（ADR 0010）。
// 進出伺服器的都是 JSON 字串，所以多一個收 JSON、回 JSON 的版本。

import { runCommands, type Command, type Flow } from './index';

export * from './index';

/** runCommands 的 JSON 版：flow 是流程（沒有開著的流程是 null）、commands 是指令串，回結果的 JSON。 */
export function runCommandsJson(flow: string, commands: string): string {
	return JSON.stringify(runCommands(JSON.parse(flow) as Flow | null, JSON.parse(commands) as Command[]));
}
