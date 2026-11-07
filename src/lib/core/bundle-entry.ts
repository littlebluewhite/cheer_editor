// 打包流程核心的入口（scripts/core-bundle.mjs）：伺服器用 QuickJS 跑這一包（ADR 0010）。
// 進出伺服器的都是 JSON 字串，所以多一個收 JSON、回 JSON 的版本。

import { applyRemoteChange, remoteChange, runCommands, type Command, type Flow, type RemoteChange } from './index';

export * from './index';

/**
 * runCommands 的 JSON 版：flow 是流程（沒有開著的流程是 null）、commands 是指令串、stepId 是步驟 id（字串，不是 JSON），
 * 回結果的 JSON。
 */
export function runCommandsJson(flow: string, commands: string, stepId: string): string {
	return JSON.stringify(runCommands(JSON.parse(flow) as Flow | null, JSON.parse(commands) as Command[], stepId));
}

/** remoteChange 的 JSON 版：改之前、改之後的流程 → 要送給房間裡其他人的改動（#253）。 */
export function remoteChangeJson(before: string, after: string): string {
	return JSON.stringify(remoteChange(JSON.parse(before) as Flow, JSON.parse(after) as Flow));
}

/** applyRemoteChange 的 JSON 版（伺服器測試用：別人收到的改動套上去跟伺服器一樣）。 */
export function applyRemoteChangeJson(flow: string, change: string): string {
	return JSON.stringify(applyRemoteChange(JSON.parse(flow) as Flow, JSON.parse(change) as RemoteChange));
}
