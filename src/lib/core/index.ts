// 流程核心的對外介面。畫面只從這裡 import，不碰 core 裡的其他檔案。
// 這一層是純 TypeScript：不碰 DOM、Svelte、Web Audio、檔案對話框。

export type { CommandResult, ConfirmOption } from './result';

export { createFlow, memberName, renameFlow } from './flow';
export type { Flow, NewFlowInput } from './flow';

export { readFlowFile, segmentsMissingAudio, writeFlowFile } from './flow-file';
export type { AudioBytes, FlowDocument, ReadFlowFileResult, Upgrade } from './flow-file';

export {
	GENDERS,
	GLOBAL_ROLES,
	MAX_MEMBERS,
	addMembers,
	deleteMember,
	memberMarkers,
	setMarkers,
	updateMember
} from './members';
export type { Gender, GlobalRole, MarkerStyle, Member, MemberChanges, NewMemberInput } from './members';

export {
	ACTION_CATEGORIES,
	actionLabel,
	actionSeconds,
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
	updateAction
} from './actions';
export type { Action, ActionCategory, ActionMember, MemberGroup, NewActionInput } from './actions';

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

export {
	MARKS,
	PHASE_KIND_COLORS,
	PHASE_KINDS,
	disableSuccessRate,
	enableSuccessRate,
	perPerson,
	phaseColor,
	setSquad,
	squadName
} from './success-rate';
export type { Attempt, Mark, NewAttempt, Phase, PhaseKind, PracticeKind, SuccessRate } from './success-rate';

export {
	attemptText,
	attemptWhos,
	carryRecords,
	deleteLastAttempt,
	recordableActions,
	recordAttempt
} from './records';

export { eightCountRows } from './eight-count';
export type {
	EightCountAction,
	EightCountCue,
	EightCountCueLine,
	EightCountFormation,
	EightCountRow
} from './eight-count';

export { addCustomRole, roleGlossary } from './roles';
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
	setWalks
} from './formation';
export type { Formation, FormationWalk, MoveResult, Position, Walk } from './formation';

export { FINE_ZOOM, fieldPositionText, snapPointsNear, snapPosition } from './snap';
export type { SnapPoint } from './snap';

export {
	AUDIO_EXTENSIONS,
	DEFAULT_BPM,
	MAX_BPM,
	MIN_BPM,
	addSegment,
	beatLines,
	loadSegmentAudio,
	musicLength,
	musicLengthFromAudio,
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
	parseLength,
	parseTime,
	positionText,
	rulerMarks,
	segmentSpans,
	timeText,
	timeTextWithUnit,
	toPosition,
	toSeconds,
	totalSeconds
} from './time';
export type { RulerMark, SegmentSpan, TimePosition } from './time';

export { firstBeatPreview, playbackPlan, playStartSec } from './playback';
export type { MetronomeClick, PlaybackClip, PlaybackPlan } from './playback';

export { DEFAULT_TIME_RULES, timeRuleWarnings, updateTimeRules } from './time-rules';
export type { TimeRules } from './time-rules';

export { FIELD_TEMPLATES, MAX_STRIPS, MIN_STRIPS, fieldGeometry } from './field';
export type {
	FieldConfig,
	FieldGeometry,
	FieldLayout,
	FieldTemplate,
	Line,
	Rect,
	Strip
} from './field';
