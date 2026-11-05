// 小窗（「?」說明、拍點小窗、加段選單）共用的部分：每個小窗只給內容和放哪裡。
// 放到最上層（popover）：右邊欄、時間軸的捲動容器裁不到它；跟著錨點捲動、縮放；點外面、按 Esc 就關。
// 算位置是純函式（placeBelow；拍點小窗用 cue-pop），量畫面的事在 attachment 裡（jsdom 量不到版面，ADR 0002）。
import type { Attachment } from 'svelte/attachments';
import { composing } from '#lib/ime.js';

export interface PopoverOptions {
	/** 小窗放哪裡（畫面座標）。打開、捲動、視窗變大變小、裡面讀的狀態變了，都再放一次。 */
	place: (pop: HTMLElement) => { top: number; left: number };
	/** 點外面、按 Esc：把小窗關掉。 */
	close: () => void;
	/** 點這些裡面不算點外面（例：打開小窗的鈕）；小窗自己本來就不算。 */
	inside?: (Element | undefined)[];
}

/**
 * attachment：小窗開著時掛在小窗上（小窗只在開著時才畫，或 `{@attach open && popover(...)}`）。
 * Esc 只關小窗、不往外傳（不讓編輯頁把選取也清掉）；中文輸入法選字時的 Esc 不算。
 */
export function popover(o: PopoverOptions): Attachment<HTMLElement> {
	return (el) => {
		// jsdom 沒有 popover（還會把 popover 屬性的元素當成藏起來），所以在這裡才加屬性。
		if (el.showPopover && !el.matches(':popover-open')) {
			el.popover = 'manual';
			el.showPopover();
		}
		const place = () => {
			const p = o.place(el);
			el.style.top = `${p.top}px`;
			el.style.left = `${p.left}px`;
		};
		$effect(place);
		const outside = (e: PointerEvent) => {
			const t = e.target as Node;
			if (![el, ...(o.inside ?? [])].some((x) => x?.contains(t))) o.close();
		};
		const keys = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || composing(e)) return;
			e.stopPropagation();
			o.close();
		};
		addEventListener('scroll', place, true);
		addEventListener('resize', place);
		addEventListener('pointerdown', outside);
		addEventListener('keydown', keys, true);
		return () => {
			removeEventListener('scroll', place, true);
			removeEventListener('resize', place);
			removeEventListener('pointerdown', outside);
			removeEventListener('keydown', keys, true);
			if (el.popover) el.hidePopover();
		};
	};
}

export interface BelowInput {
	/** 錨點（打開小窗的那個鈕），畫面座標。 */
	anchor: { top: number; bottom: number; left: number; right: number };
	pop: { w: number; h: number };
	/** 畫面多大。 */
	view: { w: number; h: number };
	/** 小窗跟錨點中間留的空隙。 */
	gap: number;
	/** 小窗的左邊對齊錨點的左邊，還是右邊對齊右邊。 */
	align: 'left' | 'right';
	/** 下面放不下就翻到上面、上下也不超出畫面；false：永遠放在錨點下面，只管左右（加段選單）。 */
	flip: boolean;
}

/** 小窗離畫面邊上至少多遠。 */
const MARGIN = 8;

/** 小窗放在錨點下面；畫面下面放不下、上面放得下就放上面（flip）。左右（flip 時上下也）不超出畫面。 */
export function placeBelow(input: BelowInput): { top: number; left: number } {
	const { anchor, pop, view, gap } = input;
	let top = anchor.bottom + gap;
	if (input.flip) {
		if (top + pop.h > view.h - MARGIN && anchor.top - gap - pop.h >= MARGIN) top = anchor.top - gap - pop.h;
		top = Math.max(MARGIN, Math.min(top, view.h - MARGIN - pop.h));
	}
	const left = input.align === 'left' ? anchor.left : anchor.right - pop.w;
	return { top, left: Math.max(MARGIN, Math.min(left, view.w - MARGIN - pop.w)) };
}

/** 給 popover 的 place：量好錨點、小窗、畫面，照 placeBelow 放。 */
export function below(anchor: Element, how: Pick<BelowInput, 'gap' | 'align' | 'flip'>) {
	return (pop: HTMLElement) =>
		placeBelow({
			anchor: anchor.getBoundingClientRect(),
			pop: { w: pop.offsetWidth, h: pop.offsetHeight },
			view: { w: innerWidth, h: innerHeight },
			...how
		});
}
