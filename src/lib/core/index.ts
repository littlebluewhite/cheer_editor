// 流程核心的對外介面。畫面只從這裡 import，不碰 core 裡的其他檔案。
// 這一層是純 TypeScript：不碰 DOM、Svelte、Web Audio、檔案對話框。

export type { CommandResult, ConfirmOption, ReadResult, RecordsChoice } from './result';
export { said } from './why';
export type { Said, Why, WhyCode, WhyParam } from './why';

export { COMMAND_NAMES, runCommand, runCommands } from './commands';
export { inStep } from './ids';
export type { Command, CommandArgs, CommandName, CommandOutcome, StepResult } from './commands';

export { adjustField, createFlow, flowNameProblem, memberName, renameFlow, sameFlow, stripsProblem } from './flow';
export type { Flow, NewFlowInput } from './flow';

export { MAX_CHARS, charCount, charLimit, charStart, firstChars, tooLong } from './text-length';
export type { LimitedText } from './text-length';

export { changeLabel } from './change-label';

export {
	checkFlowDocument,
	FORMAT_VERSION,
	missingAudioNames,
	readFlowFile,
	segmentsMissingAudio,
	writeFlowFile
} from './flow-file';
export type { AudioBytes, CheckFlowDocumentResult, FlowDocument, ReadFlowFileResult, Upgrade } from './flow-file';

export { flowProblem } from './flow-check';

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

export { ACTION_CATEGORIES, actionLabel, actionNameWhy, actionSeconds, actionWhy, categoryWhy } from './action-types';
export type { Action, ActionCategory, ActionChanges, ActionMember, NewActionInput } from './action-types';
export {
	actionSlotAt,
	busyMembers,
	addAction,
	deleteAction,
	idleAt,
	memberActionAt,
	memberGroup,
	moveAction,
	previousActions,
	layersAt,
	stackedAt,
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
	copyCues,
	cueForMember,
	cuesAt,
	cueWhy,
	cueWordWhy,
	pasteCues,
	placeCue,
	sameWho,
	usedWords,
	whoWhy
} from './cues';
export type { Cue, CueKind, LiveCues, NewCueInput, Who } from './cues';

export { blankPhases, fillOk, groupsPeople, keptAttempt, MARKS, perPerson, pickedAutoSave, squadBadge, squadNumber, squadsOf, squadWhy } from './success-rate';
export type { Attempt, Mark, NewAttempt, PracticeKind, SquadBadge, SuccessRate } from './success-rate';

export {
	attemptText,
	attemptWhos,
	NOT_YET_MARK,
	NOT_YET_TITLE,
	carryRecords,
	changeAttempt,
	deleteAttempt,
	deleteAttempts,
	deleteLastAttempt,
	deleteLastRunThrough,
	lastRunThrough,
	runThroughsOn,
	recordableActions,
	recordAttempt,
	recordRunThrough,
	recordsLoss,
	recordsPatch,
	redoRecords,
	restoreAttempt,
	restoreRunThrough,
	undoRecords
} from './records';
export type { RecordsPatch, RemovedRunThrough, RunThroughMarks } from './records';
export { checkRecord, putRecords, takeRecords } from './stored-records';
export type { CheckedAttempt, StoredAttempt } from './stored-records';

export { nextPhaseKind, PHASE_KIND_COLORS, PHASE_KINDS, phaseColor, phaseKindsFor, phaseKindWhy, phaseLabel, phaseWhy } from './phase-types';
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

export { actionEights, beatSpanWhy, phaseRows } from './beat-range';
export type { ActionEight, EightPiece } from './beat-range';

export { eightCountRows, eightCountView, formationNowWhy, memberNowWhy, nearbyEights, teamWho } from './eight-count';
export type {
	EightCountAction,
	EightCountCue,
	EightCountCueLine,
	EightCountFormation,
	EightCountPhase,
	EightCountRow,
	NearbyEights
} from './eight-count';

export { addCustomRole, defaultRoles, deleteCustomRole, FIXED_ROLES, pickableRoles, roleGlossary, roleWhy, updateCustomRole } from './roles';
export type { CustomRole, RoleEntry } from './roles';

export {
	TOO_FAST_MPS,
	TIRING_MPS,
	clearWalks,
	currentFormation,
	deleteFormation,
	formationAt,
	snapPlayhead,
	formationTimes,
	formationWalks,
	insertFormation,
	memberWalk,
	moveFormation,
	moveFormationHint,
	groupPositions,
	moveGroup,
	moveMembers,
	moveTargetWhy,
	positionsAt,
	renameFormation,
	setPositions,
	setTeamWalks,
	setWalks,
	walkSpanAt,
	walkSpeedWhy
} from './formation';
export type { Formation, FormationWalk, MoveResult, Position, Walk, WalkSpan } from './formation';

export { alignColumn, alignRow, mirrorPositions, spreadEvenly } from './group-moves';

export { FINE_ZOOM, fieldPositionWhy, snapGroup, snapPointsNear, snapPosition } from './snap';
export type { SnapPoint } from './snap';

export {
	AUDIO_EXTENSIONS,
	audioExtension,
	BROKEN_AUDIO,
	DEFAULT_BPM,
	MAX_BPM,
	MAX_CHANT_SEC,
	MAX_EIGHTS,
	MIN_BPM,
	addSegment,
	audioOverlaps,
	beatLines,
	fitSegmentToAudio,
	loadSegmentAudio,
	musicLength,
	newChantTenths,
	readSegmentNumber,
	updateSegment
} from './segment';
export type {
	AudioLengths,
	AudioOverlap,
	AudioRef,
	BeatLine,
	BeatTiming,
	ChantSegment,
	MusicLength,
	MusicSegment,
	Segment,
	SegmentKind,
	SegmentNumberField,
	SegmentPatch
} from './segment';

export {
	HALF_BEATS_PER_BEAT,
	HALF_BEATS_PER_EIGHT,
	atText,
	atWhy,
	clockText,
	farthestLegal,
	fromWhy,
	labelWhy,
	lengthText,
	lengthWhy,
	nearestPosition,
	positionWhy,
	readJump,
	readLength,
	readStart,
	readTime,
	rulerMarks,
	spacedLabels,
	segmentSpans,
	snapToBeat,
	stepPlayhead,
	timeExamples,
	timeInputWhy,
	timeText,
	timeWhy,
	toPosition,
	toSeconds,
	totalSeconds,
	units
} from './time';
export type { RulerMark, SegmentSpan, TimeField, TimePosition } from './time';

export {
	VIDEO_FPS,
	VIDEO_INTRO_SEC,
	VIDEO_OUTRO_SEC,
	videoAudioClips,
	videoDurationSec,
	videoFrame,
	videoFrames,
	videoRows
} from './video-frame';
export type { VideoFrameData, VideoRow } from './video-frame';

export { actionRange, firstBeatPreview, playbackPlan, playStartSec, rangeEnd, rangeSeconds, resumeSec, type RepeatRange } from './playback';
export type { MetronomeClick, PlaybackClip, PlaybackPlan } from './playback';

export { actionHints, duplicateNames, musicOverrunSec, samePoint, stackedMembers } from './hints';

export { deleteSegment, moveSegment, splitSegment } from './segment-order';

export { insertBeats } from './insert-beats';
export {
	anchoredSeconds,
	BOOKMARK_EDGES,
	REPEAT_EDGES,
	samePosition,
	type AnchoredRange,
	type AnchorEdges,
	type RangeSeconds
} from './anchored-range';
export {
	addBookmark,
	bookmarkAction,
	bookmarkOfRange,
	bookmarkSeconds,
	bookmarksOf,
	deleteBookmark,
	lostBookmarks,
	renameBookmark,
	startAt,
	sweepBookmarks,
	type Bookmark
} from './bookmarks';

export { DEFAULT_TIME_RULES, timeRuleWarnings, updateTimeRules } from './time-rules';
export type { TimeRules, TimeRuleWarning } from './time-rules';

export {
	CELL_M,
	FIELD_TEMPLATES,
	MAX_STRIPS,
	MIN_STRIPS,
	NUMBER_BAND,
	fieldGeometry,
	fieldNumbers,
	frontLabelAt,
	fullView
} from './field';
export type {
	FieldConfig,
	FieldGeometry,
	FieldLayout,
	FieldTemplate,
	Line,
	Rect,
	Strip
} from './field';

export { markCovered, RAISED_FILL_OPACITY } from './layer-cover';
export type { LayerDot, CoveredDot } from './layer-cover';

export { clashes } from './clash';
export type { Clash } from './clash';

export { MIN_TAPS, tapBpm } from './tap-tempo';

export { diffFlows } from './diff';
export type { ThingChange } from './diff';
export { stepKeys } from './step-keys';
export { applyRemoteChange, remoteChange } from './remote-change';
export type { RemoteChange } from './remote-change';
export { joinUndo, runUndo, undoChanges, undone } from './cloud-undo';
export type { UndoChanges, UndoOutcome } from './cloud-undo';
export { KEPT_DAYS, takeStep } from './room-step';
export type { ClearedRecord, LoggedStep, RoomRecord, SentStep, StepAsk, StepRefusal, StepVerdict } from './room-step';
export { receiveRecords } from './room-records';
export type { KnownRecord, RecordRefusal, RecordsAsk, RecordVerdict } from './room-records';
export { travelChange, travelOrder } from './undo-order';
