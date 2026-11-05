// 流程核心的對外介面。畫面只從這裡 import，不碰 core 裡的其他檔案。
// 這一層是純 TypeScript：不碰 DOM、Svelte、Web Audio、檔案對話框。

export type { CommandResult, ConfirmOption, RecordsChoice } from './result';

export { createFlow, memberName, renameFlow, stripsProblem } from './flow';
export type { Flow, NewFlowInput } from './flow';

export { readFlowFile, segmentsMissingAudio, writeFlowFile } from './flow-file';
export type { AudioBytes, FlowDocument, ReadFlowFileResult, Upgrade } from './flow-file';

export {
	GENDERS,
	GLOBAL_ROLES,
	MAX_MEMBERS,
	addMemberLines,
	addMembers,
	deleteMember,
	memberMarkers,
	moveMember,
	setMarkers,
	updateMember
} from './members';
export type { AddMembersResult, Gender, GlobalRole, MarkerStyle, Member, MemberChanges, NewMemberInput } from './members';

export { ACTION_CATEGORIES, actionLabel, actionSeconds } from './action-types';
export type { Action, ActionCategory, ActionChanges, ActionMember, NewActionInput } from './action-types';
export {
	actionSlotAt,
	addAction,
	deleteAction,
	idleAt,
	memberActionAt,
	memberGroup,
	moveAction,
	previousActions,
	raisedAt,
	resizeAction,
	setSquad,
	updateAction
} from './actions';
export type { MemberGroup } from './actions';

export {
	COUNT_WORDS,
	CUE_KIND_LABELS,
	CUE_KINDS,
	MOTION_WORDS,
	STEP_WORDS,
	clearCues,
	cueForMember,
	cuesAt,
	cueText,
	placeCue,
	sameWho,
	usedWords,
	whoName
} from './cues';
export type { Cue, CueKind, LiveCues, NewCueInput, Who } from './cues';

export { groupsPeople, keptAttempt, MARKS, perPerson, squadName, squadNumber, squadsOf } from './success-rate';
export type { Attempt, Mark, NewAttempt, PracticeKind, SuccessRate } from './success-rate';

export {
	attemptText,
	attemptWhos,
	carryRecords,
	deleteLastAttempt,
	recordableActions,
	recordAttempt,
	recordRunThrough
} from './records';
export type { RunThroughMarks } from './records';

export { PHASE_KIND_COLORS, PHASE_KINDS, phaseColor, phaseLabel } from './phase-types';
export type { Phase, PhaseKind } from './phase-types';
export { addPhase, clearPhaseBeats, deletePhase, markPhaseBeats, updatePhase } from './phases';
export type { NewPhaseInput, PhaseChange } from './phases';
export { ACTION_COLORS, NO_SQUAD_COLOR, PHASE_COLORS, squadColor } from './colors';

export {
	cellDetail,
	completionPercent,
	dailyTable,
	percent,
	periodRange,
	rateBand,
	rateCounts,
	rateTable,
	successPercent,
	weakestPhase
} from './rates';
export type { DailyTable, DetailDay, Period, RateCounts, RateFilter, RateTable, Tally, WholeTally } from './rates';

export { eightCountRows } from './eight-count';
export type {
	EightCountAction,
	EightCountCue,
	EightCountCueLine,
	EightCountFormation,
	EightCountPhase,
	EightCountRow
} from './eight-count';

export { addCustomRole, defaultRoles, deleteCustomRole, roleGlossary, updateCustomRole } from './roles';
export type { CustomRole, RoleEntry } from './roles';

export {
	TOO_FAST_MPS,
	TIRING_MPS,
	clearWalks,
	currentFormation,
	deleteFormation,
	formationAt,
	formationTimes,
	formationWalks,
	insertFormation,
	matchPrevious,
	memberWalk,
	moveFormation,
	moveFormationHint,
	moveMembers,
	moveTargetText,
	positionsAt,
	renameFormation,
	setPositions,
	setTeamWalks,
	setWalks
} from './formation';
export type { Formation, FormationWalk, MoveResult, Position, Walk } from './formation';

export { FINE_ZOOM, fieldPositionText, snapPointsNear, snapPosition } from './snap';
export type { SnapPoint } from './snap';

export {
	AUDIO_EXTENSIONS,
	DEFAULT_BPM,
	MAX_BPM,
	MAX_CHANT_SEC,
	MAX_EIGHTS,
	MIN_BPM,
	addSegment,
	beatLines,
	fitSegmentToAudio,
	loadSegmentAudio,
	musicLength,
	updateSegment
} from './segment';
export type {
	AudioRef,
	BeatLine,
	BeatTiming,
	ChantSegment,
	MusicLength,
	MusicSegment,
	Segment,
	SegmentKind,
	SegmentPatch
} from './segment';

export {
	HALF_BEATS_PER_BEAT,
	HALF_BEATS_PER_EIGHT,
	atText,
	lengthText,
	nearestPosition,
	parseAt,
	parseNumber,
	parseLength,
	parseTime,
	positionText,
	rulerMarks,
	segmentSpans,
	snapToBeat,
	stepPlayhead,
	timeText,
	timeTextWithUnit,
	toPosition,
	toSeconds,
	totalSeconds
} from './time';
export type { RulerMark, SegmentSpan, TimePosition } from './time';

export { firstBeatPreview, playbackPlan, playStartSec } from './playback';
export type { MetronomeClick, PlaybackClip, PlaybackPlan } from './playback';

export { actionHints, duplicateNames, musicOverrunSec, stackedMembers } from './hints';

export { deleteSegment, moveSegment } from './segment-order';

export { DEFAULT_TIME_RULES, timeRuleWarnings, updateTimeRules } from './time-rules';
export type { TimeRules } from './time-rules';

export { CELL_M, FIELD_TEMPLATES, MAX_STRIPS, MIN_STRIPS, fieldGeometry } from './field';
export type {
	FieldConfig,
	FieldGeometry,
	FieldLayout,
	FieldTemplate,
	Line,
	Rect,
	Strip
} from './field';

export { clashes } from './clash';
export type { Clash } from './clash';
