// 拖人時的吸附，和可以直接講給隊員聽的位置文字。
// 每格裡吸格線、1/4、1/2、3/4；放大 ×2 以上再多 1/8、3/8、5/8、7/8。左右、前後同一套，墊子外也一樣。

import { CELL_M, fieldGeometry, type FieldConfig } from './field';
import type { Position } from './formation';
import type { Why, WhyCode } from './why';

/** 放大到這個倍率以上，才多八等分的吸附點。 */
export const FINE_ZOOM = 2;

/** 格子單位的容差：小於這個就當成在同一點上。 */
const EPS = 1e-6;

/** 拖人時冒出來的一個吸附小點。fine = 八等分才有的點。 */
export interface SnapPoint {
	x: number;
	y: number;
	fine: boolean;
}

/** 把公尺座標吸到最近的吸附點；最遠到墊子外 1 m。 */
export function snapPosition(field: FieldConfig, [x, y]: Position, zoom: number): Position {
	const div = divisions(zoom);
	return axes(field).map((a, i) => snapAxis([x, y][i], a, div)) as Position;
}

/**
 * 拖人（一個或整組）：id 是按到的人，orig 是一起移的人原本的位置，want 是他被拖到的地方。
 * 照他吸附，其他人照他的位移一起移；拖過頭（有人會超出墊子外 1 m）就停在最遠的地方：
 * 每個方向上每個人都不出界的範圍裡最靠 want 的吸附點。clamped = 有停在邊界。
 */
export function snapGroup(
	field: FieldConfig,
	orig: Record<string, Position>,
	id: string,
	want: Position,
	zoom: number
): { at: Position; clamped: boolean } {
	const div = divisions(zoom);
	const all = Object.values(orig);
	let clamped = false;
	const at = axes(field).map((a, i) => {
		const own = orig[id][i];
		const lo = a.lo + own - Math.min(...all.map((p) => p[i]));
		const hi = a.hi + own - Math.max(...all.map((p) => p[i]));
		if (want[i] < lo - EPS || want[i] > hi + EPS) clamped = true;
		const v = snapAxis(want[i], { ...a, lo, hi }, div);
		// 範圍裡沒有吸附點（原本就不在格子上的人擠在邊上）：照範圍夾
		return Math.min(Math.max(v, lo), hi);
	}) as Position;
	return { at, clamped };
}

/** 這個點附近（前後左右各多一格）的吸附點，給畫面在拖的時候畫成小點。 */
export function snapPointsNear(field: FieldConfig, [x, y]: Position, zoom: number): SnapPoint[] {
	const div = divisions(zoom);
	const [xs, ys] = axes(field).map((a, i) => axisPointsNear([x, y][i], a, div));
	return xs.flatMap((px) => ys.map((py) => ({ x: px.at, y: py.at, fine: px.fine || py.fine })));
}

/**
 * 「第 3 條 左起 1/4｜正面起第 2 格 1/2」這種位置文字（畫面照語言寫）。
 * 直放：條是左右數、格是從正面往後數；橫放：條是從正面往後數（第 1 條最靠近裁判）、格是左右數。
 */
export function fieldPositionWhy(field: FieldConfig, [x, y]: Position): Why {
	const { mat, cols, rows } = fieldGeometry(field);
	const across: TextAxis = { u: (x - mat.x) / CELL_M, n: cols, codes: AXIS_CODES.across };
	const fromFront: TextAxis = { u: (mat.y + mat.height - y) / CELL_M, n: rows, codes: AXIS_CODES.fromFront };
	return field.layout === 'vertical'
		? { code: 'snap_position', strip: axisWhy(across, 'strip'), cell: axisWhy(fromFront, 'cell') }
		: { code: 'snap_position', strip: axisWhy(fromFront, 'strip'), cell: axisWhy(across, 'cell') };
}

interface Axis {
	/** 墊子的邊（格線從這裡開始）。 */
	origin: number;
	/** 可以站的範圍（墊子外 1 m）。 */
	lo: number;
	hi: number;
}

function axes(field: FieldConfig): [Axis, Axis] {
	const { mat, outer } = fieldGeometry(field);
	return [
		{ origin: mat.x, lo: outer.x, hi: outer.x + outer.width },
		{ origin: mat.y, lo: outer.y, hi: outer.y + outer.height }
	];
}

function divisions(zoom: number): number {
	return zoom >= FINE_ZOOM ? 8 : 4;
}

function snapAxis(v: number, { origin, lo, hi }: Axis, div: number): number {
	const step = CELL_M / div;
	const at = (k: number) => origin + k * step;
	let k = Math.round((Math.min(Math.max(v, lo), hi) - origin) / step);
	if (at(k) < lo - 1e-9) k++;
	if (at(k) > hi + 1e-9) k--;
	return at(k);
}

function axisPointsNear(v: number, { origin, lo, hi }: Axis, div: number) {
	const step = CELL_M / div;
	const cell = Math.floor((v - origin) / CELL_M);
	const points: { at: number; fine: boolean }[] = [];
	for (let k = (cell - 1) * div; k <= (cell + 2) * div; k++) {
		const at = origin + k * step;
		if (at >= lo - 1e-9 && at <= hi + 1e-9) points.push({ at, fine: div === 8 && Math.abs(k % 2) === 1 });
	}
	return points;
}

interface TextAxis {
	/** 從起點那一邊算起幾格。 */
	u: number;
	/** 墊子在這個方向有幾條或幾格。 */
	n: number;
	codes: AxisCodes;
}

/** 一個方向的位置的句子：墊子外（起點那邊、另一邊）；條的起點緣、終點緣、條裡幾分之幾；格的起點緣、終點緣、兩格之間、格裡幾分之幾。 */
interface AxisCodes {
	outsideNear: WhyCode;
	outsideFar: WhyCode;
	stripStart: WhyCode;
	stripEnd: WhyCode;
	strip: WhyCode;
	cellStart: WhyCode;
	cellEnd: WhyCode;
	between: WhyCode;
	cell: WhyCode;
}

/** 左右（左起）和前後（正面起）兩個方向的句子。 */
const AXIS_CODES: Record<'across' | 'fromFront', AxisCodes> = {
	across: {
		outsideNear: 'snap_outside_left',
		outsideFar: 'snap_outside_right',
		stripStart: 'snap_strip_left_edge',
		stripEnd: 'snap_strip_right_edge',
		strip: 'snap_strip_from_left',
		cellStart: 'snap_cell_left_edge',
		cellEnd: 'snap_cell_right_edge',
		between: 'snap_cells_from_left',
		cell: 'snap_cell_from_left'
	},
	fromFront: {
		outsideNear: 'snap_outside_front',
		outsideFar: 'snap_outside_back',
		stripStart: 'snap_strip_front_edge',
		stripEnd: 'snap_strip_back_edge',
		strip: 'snap_strip_from_front',
		cellStart: 'snap_cell_front_edge',
		cellEnd: 'snap_cell_back_edge',
		between: 'snap_cells_from_front',
		cell: 'snap_cell_from_front'
	}
};

/**
 * 一個方向的位置，都用「第幾條、第幾格」講：格裡寫幾分之幾；在格線上寫在哪兩條（格）之間，
 * 條和條之間就是接縫；不在八等分點上（例如舊檔）寫最近的那一點，前面加「約」。
 */
function axisWhy({ u, n, codes }: TextAxis, kind: 'strip' | 'cell'): Why {
	if (u < -EPS) return { code: codes.outsideNear, n: outside(-u) };
	if (u > n + EPS) return { code: codes.outsideFar, n: outside(u - n) };
	const k = Math.round(u * 8);
	const exact = Math.abs(u - k / 8) < EPS;
	const about = <T extends Why | string>(what: T): T | Why => (exact ? what : { code: 'snap_about', what });
	const i = Math.floor(k / 8);
	const strip = kind === 'strip';
	if (i >= n) return about({ code: strip ? codes.stripEnd : codes.cellEnd, n });
	if (k % 8 === 0) {
		if (i === 0) return about({ code: strip ? codes.stripStart : codes.cellStart, n: 1 });
		return about({ code: strip ? 'snap_seam' : codes.between, a: i, b: i + 1 });
	}
	return { code: strip ? codes.strip : codes.cell, n: i + 1, f: about(FRACTION_NAMES[k % 8]) };
}

const FRACTION_NAMES = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];

/** 場地外幾格（最多出界 1 m，不到一格）：照八等分寫，不在點上加「約」，太近也算 1/8。 */
function outside(d: number): string | Why {
	const k = Math.round(d * 8);
	const n = k >= 8 ? `${k / 8}` : FRACTION_NAMES[Math.max(k, 1)];
	return Math.abs(d - k / 8) < EPS ? n : { code: 'snap_about', what: n };
}
