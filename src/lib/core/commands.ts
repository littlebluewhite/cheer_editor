// 指令表：指令名字 → 指令。畫面和伺服器都用「名字＋參數」叫同一個指令（ADR 0010、0011）。
// 參數是指令除了流程、教練的回答以外的那些，照順序放成一串；教練的回答（確定、保留／清掉）放在 options。
// 參數、回答都要能轉成 JSON 再轉回來（送到伺服器）。
// 一步可以帶好幾個指令（runCommands）：照順序跑，全算或全不算。
// 一步帶一個步驟 id（亂數，由外面發）：一步裡新東西的 id 由它算出來，同一個步驟 id 跑同一步算出一樣的 id（ADR 0011）。

import { inStep } from './ids';
import { addAction, deleteAction, moveAction, resizeAction, setSquad, updateAction } from './actions';
import { clearCues, pasteCues, placeCue } from './cues';
import { adjustField, createFlow, renameFlow, type Flow } from './flow';
import {
	clearWalks,
	deleteFormation,
	insertFormation,
	moveGroup,
	moveFormation,
	moveMembers,
	renameFormation,
	setPositions,
	setTeamWalks,
	setWalks
} from './formation';
import { insertBeats } from './insert-beats';
import { addMemberLines, addMembers, deleteMember, moveMember, setMarkers, updateMember } from './members';
import { addPhase, clearPhaseBeats, deletePhase, markPhaseBeats, updatePhase } from './phases';
import {
	changeAttempt,
	deleteAttempt,
	deleteAttempts,
	deleteLastAttempt,
	deleteLastRunThrough,
	recordAttempt,
	recordRunThrough,
	restoreAttempt,
	restoreRunThrough
} from './records';
import { blocked, type CommandResult, type ConfirmOption } from './result';
import { addCustomRole, deleteCustomRole, updateCustomRole } from './roles';
import {
	addSegment,
	fitSegmentToAudio,
	loadSegmentAudio,
	updateSegment,
	type AudioLengths,
	type SegmentPatch
} from './segment';
import { deleteSegment, moveSegment, splitSegment } from './segment-order';
import { updateTimeRules } from './time-rules';

/** 表裡的一個指令：在流程上照參數跑，帶著教練的回答。 */
type Entry<A extends unknown[], R> = (flow: Flow, args: A, options: ConfirmOption) => R;

/** 指令的參數：流程後面那些。 */
type Rest<F> = F extends (flow: Flow, ...args: infer A) => unknown ? A : never;
/** 最後一個參數是教練的回答的指令：去掉流程和回答，剩下的參數。 */
type Asked<F> = F extends (flow: Flow, ...args: [...infer A, ConfirmOption?]) => unknown ? A : never;

/** 不問的指令。 */
const plain =
	<F extends (flow: Flow, ...args: never[]) => CommandResult>(fn: F): Entry<Rest<F>, ReturnType<F>> =>
	(flow, args) =>
		(fn as unknown as (flow: Flow, ...args: unknown[]) => ReturnType<F>)(flow, ...args);

/** 會問的指令：教練的回答是最後一個參數。 */
const asking =
	<F extends (flow: Flow, ...args: never[]) => CommandResult>(fn: F): Entry<Asked<F>, ReturnType<F>> =>
	(flow, args, options) =>
		(fn as unknown as (flow: Flow, ...args: unknown[]) => ReturnType<F>)(flow, ...args, options);

/** 指令表。加新指令要登記在這裡。 */
const COMMANDS = {
	// 新建流程不用開著的流程。
	createFlow: ((_, [input]) => createFlow(input)) as Entry<Parameters<typeof createFlow>, CommandResult>,
	renameFlow: plain(renameFlow),
	adjustField: asking(adjustField),

	addMembers: plain(addMembers),
	addMemberLines: plain(addMemberLines),
	updateMember: asking(updateMember),
	deleteMember: asking(deleteMember),
	moveMember: plain(moveMember),
	setMarkers: plain(setMarkers),

	addAction: plain(addAction),
	updateAction: asking(updateAction),
	moveAction: asking(moveAction),
	resizeAction: asking(resizeAction),
	deleteAction: asking(deleteAction),
	setSquad: asking(setSquad),

	placeCue: plain(placeCue),
	clearCues: plain(clearCues),
	pasteCues: plain(pasteCues),

	recordAttempt: plain(recordAttempt),
	changeAttempt: plain(changeAttempt),
	deleteAttempt: plain(deleteAttempt),
	deleteAttempts: plain(deleteAttempts),
	restoreAttempt: plain(restoreAttempt),
	deleteLastAttempt: plain(deleteLastAttempt),
	recordRunThrough: plain(recordRunThrough),
	deleteLastRunThrough: plain(deleteLastRunThrough),
	restoreRunThrough: plain(restoreRunThrough),

	addPhase: asking(addPhase),
	updatePhase: plain(updatePhase),
	deletePhase: asking(deletePhase),
	markPhaseBeats: asking(markPhaseBeats),
	clearPhaseBeats: asking(clearPhaseBeats),

	addCustomRole: plain(addCustomRole),
	updateCustomRole: plain(updateCustomRole),
	deleteCustomRole: asking(deleteCustomRole),

	setPositions: plain(setPositions),
	moveMembers: plain(moveMembers),
	moveGroup: plain(moveGroup),
	renameFormation: plain(renameFormation),
	deleteFormation: plain(deleteFormation),
	setWalks: plain(setWalks),
	setTeamWalks: plain(setTeamWalks),
	clearWalks: plain(clearWalks),
	insertFormation: plain(insertFormation),
	moveFormation: plain(moveFormation),

	addSegment: plain(addSegment),
	// 回答在音樂長度前面：參數是段、改什麼、音樂長度。
	updateSegment: ((flow, [segmentId, patch, lengths], options) =>
		updateSegment(flow, segmentId, patch, options, lengths)) as Entry<
		[segmentId: string, patch: SegmentPatch, lengths?: AudioLengths],
		CommandResult
	>,
	loadSegmentAudio: plain(loadSegmentAudio),
	fitSegmentToAudio: asking(fitSegmentToAudio),
	deleteSegment: asking(deleteSegment),
	moveSegment: plain(moveSegment),
	splitSegment: plain(splitSegment),
	insertBeats: plain(insertBeats),
	updateTimeRules: plain(updateTimeRules)
};

type Commands = typeof COMMANDS;

export type CommandName = keyof Commands;

/** 指令的參數（不含流程和教練的回答）。 */
export type CommandArgs<N extends CommandName> = Parameters<Commands[N]>[1];

/** 指令跑完的結果（有些指令多帶東西，例：新加的那一筆的 id）。 */
export type CommandOutcome<N extends CommandName> = ReturnType<Commands[N]>;

/** 用名字叫的一個指令：名字、參數、教練的回答（按了確定、選了保留／清掉；沒問過就不帶）。 */
export type Command<N extends CommandName = CommandName> = {
	[K in N]: { name: K; args: CommandArgs<K>; options?: ConfirmOption };
}[N];

/** 一步帶好幾個指令的結果：沒成功時 at 是被擋或要問的那個指令是第幾個（0 起）。 */
export type StepResult = CommandResult | (Exclude<CommandResult, { kind: 'ok' }> & { at: number });

/** 登記的指令名字。 */
export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

/** 沒有開著的流程（只有新建流程叫得動）時被擋的原因。 */
const NO_FLOW = '沒有開著的流程';

/**
 * 用名字＋參數叫一個指令，跟在這一步裡（inStep）直接叫一樣。flow 是 null（沒有開著的流程）時只有新建流程叫得動。
 * stepId 是這一步的步驟 id（見 runCommands）。
 */
export function runCommand<N extends CommandName>(
	flow: Flow | null,
	command: Command<N>,
	stepId: string
): CommandOutcome<N> {
	return inStep(stepId, () => run(flow, command as Command)) as CommandOutcome<N>;
}

function run(flow: Flow | null, command: Command): CommandResult {
	const { name, args, options = {} } = command;
	if (flow === null && name !== 'createFlow') return blocked(NO_FLOW);
	const entry = COMMANDS[name] as Entry<unknown[], CommandResult>;
	return entry(flow as Flow, args, options);
}

/**
 * 一步帶好幾個指令：照順序跑，後面的跑在前面改好的流程上。全部成功才算，多帶的結果都留著；
 * 中間一個被擋或要問，整串都不算，回那一個的結果，at 是它是第幾個。
 * stepId 是這一步的步驟 id：新東西的 id 由它算出來（整串一起算，不會撞），同一個步驟 id 跑同一串算出一樣的 id。
 */
export function runCommands(flow: Flow | null, commands: Command[], stepId: string): StepResult {
	return inStep(stepId, () => {
		let done = blocked('沒有指令') as CommandResult;
		for (const [at, command] of commands.entries()) {
			const r = run(done.kind === 'ok' ? done.flow : flow, command);
			if (r.kind !== 'ok') return { ...r, at };
			done = done.kind === 'ok' ? { ...done, ...r } : r;
		}
		return done;
	});
}
