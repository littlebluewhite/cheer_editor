// 流程核心的對外介面。畫面只從這裡 import，不碰 core 裡的其他檔案。
// 這一層是純 TypeScript：不碰 DOM、Svelte、Web Audio、檔案對話框。

export type { CommandResult } from './result';

export { createFlow } from './flow';
export type { Flow, NewFlowInput } from './flow';

export { MAX_MEMBERS, addMembers, updateMember } from './members';
export type { Gender, GlobalRole, Member, MemberChanges, NewMemberInput } from './members';

export { setPositions } from './formation';

export { FINE_ZOOM, positionText, snapPointsNear, snapPosition } from './snap';
export type { SnapPoint } from './snap';
export type { Formation, Position } from './formation';

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
