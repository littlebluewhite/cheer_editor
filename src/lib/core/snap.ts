// 拖人時的吸附，和可以直接講給隊員聽的位置文字。
// 每格裡吸格線、1/4、1/2、3/4；放大 ×2 以上再多 1/8、3/8、5/8、7/8。左右、前後同一套，墊子外也一樣。

import { CELL_M, fieldGeometry, type FieldConfig } from './field';
import type { Position } from './formation';

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

/** 這個點附近（前後左右各多一格）的吸附點，給畫面在拖的時候畫成小點。 */
export function snapPointsNear(field: FieldConfig, [x, y]: Position, zoom: number): SnapPoint[] {
	const div = divisions(zoom);
	const [xs, ys] = axes(field).map((a, i) => axisPointsNear([x, y][i], a, div));
	return xs.flatMap((px) => ys.map((py) => ({ x: px.at, y: py.at, fine: px.fine || py.fine })));
}

/**
 * 「第 3 條 左起 1/4｜正面起第 2 格 1/2」這種位置文字。
 * 直放：條是左右數、格是從正面往後數；橫放：條是從正面往後數（第 1 條最靠近裁判）、格是左右數。
 */
export function fieldPositionText(field: FieldConfig, [x, y]: Position): string {
	const { mat, cols, rows } = fieldGeometry(field);
	const vertical = field.layout === 'vertical';
	const across = {
		u: (x - mat.x) / CELL_M,
		n: cols,
		start: '左起',
		endLine: '場地右緣',
		near: '左邊',
		far: '右邊'
	};
	const fromFront = {
		u: (mat.y + mat.height - y) / CELL_M,
		n: rows,
		start: '正面起',
		endLine: '場地後緣',
		near: '正面那邊',
		far: '後面'
	};
	return vertical
		? `${axisText(across, 'strip')}｜${axisText(fromFront, 'cell')}`
		: `${axisText(fromFront, 'strip')}｜${axisText(across, 'cell')}`;
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
	start: string;
	endLine: string;
	near: string;
	far: string;
}

function axisText(a: TextAxis, kind: 'strip' | 'cell'): string {
	if (a.u < -EPS) return `場地外${a.near} ${fracName(-a.u)} 格`;
	if (a.u > a.n + EPS) return `場地外${a.far} ${fracName(a.u - a.n)} 格`;
	const i = Math.min(Math.floor(a.u + EPS), a.n - 1);
	const f = a.u - i;
	const atEnd = f > 1 - EPS;
	if (kind === 'strip') return `第 ${i + 1} 條 ${atEnd ? a.endLine : `${a.start} ${fracName(f)}`}`;
	return `${a.start}第 ${i + 1} 格 ${atEnd ? a.endLine : fracName(f)}`;
}

const FRACTION_NAMES = ['線上', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];

function fracName(f: number): string {
	const k = Math.round(f * 8);
	if (k < 8 && Math.abs(f - k / 8) < EPS) return FRACTION_NAMES[k];
	return `${Math.round(f * 100)}%`;
}
