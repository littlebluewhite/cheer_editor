// 拍點小窗放哪裡：只算數字，量畫面的事交給 CueGrid（jsdom 量不到版面，ADR 0002）。
// 座標都是格子框裡的 px。

export interface CuePopPos {
	top: number;
	left: number;
	/** 尖角離小窗左邊多遠。 */
	arrow: number;
	/** 放在選取上面（尖角朝下）。 */
	above: boolean;
}

export interface CuePopInput {
	/** 選到的拍佔的框：上緣是第一拍的數字格，下緣是最後一拍手位那條；跨排時左右是整個格子框。 */
	sel: { top: number; bottom: number; left: number; right: number };
	/** 尖角要指的 x：放上面時指第一拍、放下面時指最後一拍（同一排都指選取中間）。 */
	arrowAbove: number;
	arrowBelow: number;
	pop: { w: number; h: number };
	/** 格子框多寬；小窗左右不超出。 */
	wrapW: number;
	/** 畫面看得到的上下範圍（換成格子框的座標）。 */
	view: { top: number; bottom: number };
	/** 一排八拍多高（含排跟排中間的空隙）。 */
	rowH: number;
	/** 按的是小窗裡的按鈕時，小窗現在的位置；其他時候 null。 */
	cur: CuePopPos | null;
}

/** 小窗跟選取中間留的空隙。 */
const GAP = 8;
/** 尖角離小窗左右邊至少多遠（圓角那裡放不下）。 */
const ARROW_EDGE = 14;

export function placeCuePop(i: CuePopInput): CuePopPos {
	const { sel, pop, cur } = i;
	let movedFrom: CuePopPos | null = null;
	if (cur) {
		// 按小窗裡的按鈕：選取沒被蓋住、也還在一個八拍以內，小窗就不動，只有尖角跟著。
		const covered = sel.top < cur.top + pop.h && sel.bottom > cur.top && sel.left < cur.left + pop.w && sel.right > cur.left;
		const gap = Math.max(sel.top - (cur.top + pop.h), cur.top - sel.bottom);
		if (!covered && gap <= i.rowH) {
			const x = cur.above ? i.arrowAbove : i.arrowBelow;
			return { ...cur, arrow: Math.min(Math.max(x - cur.left, ARROW_EDGE), pop.w - ARROW_EDGE) };
		}
		if (covered) movedFrom = cur;
	}
	const belowTop = sel.bottom + GAP;
	const aboveTop = sel.top - GAP - pop.h;
	const roomBelow = i.view.bottom - sel.bottom - GAP;
	const roomAbove = sel.top - i.view.top - GAP;
	// 被蓋住一定要搬時，上下都放得下就挑離原本近的，移動最少；不然下面放得下就放下面。
	const above =
		movedFrom && roomBelow >= pop.h && roomAbove >= pop.h
			? Math.abs(aboveTop - movedFrom.top) < Math.abs(belowTop - movedFrom.top)
			: roomBelow < pop.h && roomAbove > roomBelow;
	const x = above ? i.arrowAbove : i.arrowBelow;
	const left = Math.max(0, Math.min(x - pop.w / 2, i.wrapW - pop.w));
	return { top: above ? aboveTop : belowTop, left, arrow: x - left, above };
}
