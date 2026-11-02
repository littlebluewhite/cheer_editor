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
	updateMember
} from './members';
export type { Gender, GlobalRole, Member, MemberChanges, NewMemberInput } from './members';

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

export { eightCountRows } from './eight-count';
export type { EightCountAction, EightCountFormation, EightCountRow } from './eight-count';

export { addCustomRole, roleGlossary } from './roles';
export type { CustomRole, RoleEntry } from './roles';

export {
	TOO_FAST_MPS,
	clearWalks,
	deleteFormation,
	formationAt,
	formationTimes,
	formationWalks,
	insertFormation,
	matchPrevious,
	memberWalk,
	moveMembers,
	moveTargetText,
	positionsAt,
	setPositions,
	setWalks
} from './formation';
export type { Formation, FormationWalk, Position, Walk } from './formation';

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
	atText,
	lengthText,
	parseAt,
	parseLength,
	parseTime,
	positionText,
	rulerMarks,
	segmentSpans,
	timeText,
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
