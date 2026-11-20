// 場地幾何。座標方向見 docs/flow-file-format.md 的「位置座標」：
// 公尺，原點是中心 X，x 往畫面右邊，y 往正面（畫面下面）。

/** 一格的邊長 = 一條的寬 = 6 呎。 */
export const CELL_M = 6 * 0.3048;
/** 位置（公尺）的浮點數誤差容許值：差這麼一點點當成一樣遠、一樣前後（跟 time.ts 的 EPS 同一種做法）。 */
export const POS_EPS = 1e-6;
/** 一條的長 = 42 呎 = 7 格。 */
const CELLS_PER_STRIP = 7;
/** 墊子外可以站人的寬度。 */
const MARGIN_M = 1;
/** 自訂場地的條數範圍。 */
export const MIN_STRIPS = 1;
export const MAX_STRIPS = 12;

export type FieldLayout = 'vertical' | 'horizontal';

export interface FieldConfig {
	strips: number;
	layout: FieldLayout;
}

/** 新建流程時可選的場地範本；另外還有「自訂」。 */
export interface FieldTemplate {
	label: string;
	/** 範本旁的小字：哪些比賽用這種場地。 */
	hint: string;
	field: FieldConfig;
}

export const FIELD_TEMPLATES: readonly FieldTemplate[] = [
	{
		label: '9 條直放（預設）',
		hint: '全國賽、中等學校、大專',
		field: { strips: 9, layout: 'vertical' }
	},
	{ label: '5 條橫放', hint: '臺灣盃', field: { strips: 5, layout: 'horizontal' } }
];

export interface FieldGeometry {
	/** 正面那一邊（左右）的長，公尺。 */
	width: number;
	/** 前後的深，公尺。 */
	depth: number;
	/** 左右有幾格。 */
	cols: number;
	/** 前後有幾格。 */
	rows: number;
	/** 墊子。 */
	mat: Rect;
	/** 墊子加上外圍 1 m（隊員也能站）。 */
	outer: Rect;
	/** 每一條，照編號排。直放從畫面左邊數；橫放最靠近裁判的是第 1 條。 */
	strips: Strip[];
	/** 相鄰兩條之間的線。 */
	seams: Line[];
	/** 墊子上其餘的格子線（不含接縫）。 */
	gridLines: Line[];
}

export interface Strip {
	number: number;
	rect: Rect;
}

/** 公尺座標的長方形；x、y 是離正面最遠、畫面最左的那個角。 */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 公尺座標的線段。 */
export interface Line {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export function fieldGeometry(field: FieldConfig): FieldGeometry {
	const vertical = field.layout === 'vertical';
	const cols = vertical ? field.strips : CELLS_PER_STRIP;
	const rows = vertical ? CELLS_PER_STRIP : field.strips;
	const width = cols * CELL_M;
	const depth = rows * CELL_M;
	const left = -width / 2;
	const back = -depth / 2;

	const strips = Array.from({ length: field.strips }, (_, i): Strip => ({
		number: i + 1,
		rect: vertical
			? { x: left + i * CELL_M, y: back, width: CELL_M, height: depth }
			: { x: left, y: depth / 2 - (i + 1) * CELL_M, width, height: CELL_M }
	}));

	// 墊子內部的格子線：前後走向（x 固定）和左右走向（y 固定）。
	const frontToBack = range(1, cols).map(
		(k): Line => ({ x1: left + k * CELL_M, y1: back, x2: left + k * CELL_M, y2: -back })
	);
	const leftToRight = range(1, rows).map(
		(k): Line => ({ x1: left, y1: back + k * CELL_M, x2: -left, y2: back + k * CELL_M })
	);

	return {
		width,
		depth,
		cols,
		rows,
		mat: { x: left, y: back, width, height: depth },
		outer: {
			x: left - MARGIN_M,
			y: back - MARGIN_M,
			width: width + 2 * MARGIN_M,
			height: depth + 2 * MARGIN_M
		},
		strips,
		seams: vertical ? frontToBack : leftToRight,
		gridLines: vertical ? leftToRight : frontToBack
	};
}

/**
 * 外圍框外寫條編號、格號的那一條留多寬（公尺）：放大了的場外圓點也蓋不到編號。
 * 後面寫左右那一軸的號碼（直放的條號、橫放的格號），左邊寫前後那一軸的（直放的格號、橫放的條號）。
 * 號碼在螢幕上至少 11px，iPad 上場地小、圓點 32px 時也要放得下，所以比圓點伸出外圍框的那一截再寬一個號碼。
 */
export const NUMBER_BAND = 1.3;

/**
 * 整個場地的畫面範圍（公尺）：外圍以外再留給條編號、格號（NUMBER_BAND，左右都留，場地才置中）和「正面／裁判」字樣的空間。
 * 編輯頁拿它的長寬比分配右邊欄的寬度；流程影片的場地也用它。
 * band：號碼條留多寬。手機的檢視畫面給窄一點的，場地畫得比較大（站在外圍邊上的人會蓋到號碼）。
 */
export function fullView(field: FieldConfig, band = NUMBER_BAND): Rect {
	const { outer } = fieldGeometry(field);
	const b = band;
	return { x: outer.x - b, y: outer.y - b, width: outer.width + 2 * b, height: outer.height + b + 1 };
}

/** 場地上一個點（公尺）；跟 formation.ts 的 Position 一樣，那邊 import 這個檔，這裡不能反過來 import。 */
type Point = [number, number];

/**
 * 條號、格號寫在哪（公尺，字的基線起點）：貼著號碼條靠外的邊（離伸出外圍框的圓點最遠），
 * 放大後號碼條捲出 view 了就貼著畫面邊上。stripFont、cellFont 是字高（公尺）。
 * 直放：條號在後面、格號在左邊（正面起算）；橫放：條號在左邊、格號在後面（左起算）。
 * band 跟 fullView 給的一樣。
 */
export function fieldNumbers(
	field: FieldConfig,
	view: Rect,
	stripFont: number,
	cellFont: number,
	band = NUMBER_BAND
): { strips: { n: number; at: Point }[]; cells: { n: number; at: Point }[] } {
	const g = fieldGeometry(field);
	const vertical = field.layout === 'vertical';
	// 後面那一排：cx 是那一條或那一格左右的中間
	const topAt = (cx: number, f: number): Point => [cx, Math.max(g.outer.y - band, view.y) + 1.1 * f];
	// 左邊那一排：cy 是那一條或那一格前後的中間，兩位數也放得下
	const sideAt = (cy: number, f: number): Point => [Math.max(g.outer.x - band, view.x) + 0.65 * f, cy + 0.3 * f];
	return {
		strips: g.strips.map((s) => ({
			n: s.number,
			at: vertical
				? topAt(s.rect.x + s.rect.width / 2, stripFont)
				: sideAt(s.rect.y + s.rect.height / 2, stripFont)
		})),
		cells: Array.from({ length: vertical ? g.rows : g.cols }, (_, i) => ({
			n: i + 1,
			at: vertical
				? sideAt(g.mat.y + g.mat.height - (i + 0.5) * CELL_M, cellFont)
				: topAt(g.mat.x + (i + 0.5) * CELL_M, cellFont)
		}))
	};
}

/** 「正面／裁判」寫在哪：外圍框下面、正中間。 */
export function frontLabelAt(field: FieldConfig): Point {
	const { outer } = fieldGeometry(field);
	return [0, outer.y + outer.height + 0.7];
}

/** [from, to) 的整數。 */
function range(from: number, to: number): number[] {
	return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
