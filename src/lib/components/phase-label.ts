import { PHASE_KINDS, type Phase } from '#lib/core';

/** 環節在畫面上的名字：種類加名字，例：上法 延伸；沒取名字就只有種類。 */
export function phaseLabel(p: Phase): string {
	const kind = PHASE_KINDS.find((k) => k.key === p.kind)?.label ?? '';
	return p.name ? `${kind} ${p.name}` : kind;
}
