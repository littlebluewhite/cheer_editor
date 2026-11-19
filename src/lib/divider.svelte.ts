// 編輯頁可以拖的分界（場地和時間軸、場地和右邊欄）：拖它或按方向鍵改一邊的大小，雙擊回到預設，存在這台電腦。
// 拖到一半按 Esc 回到拖之前的大小。
// 夾在範圍內、現在畫面上多大由用的地方給（量版面的事 jsdom 量不到，ADR 0002）。

import { onEscape } from '#lib/components/pointer.js';
import { loadLayoutPx, saveLayoutPx, type LayoutSize } from '#lib/local-settings.js';

/** 按一下方向鍵改多少 px。 */
const KEY_STEP_PX = 24;

export interface DividerOptions {
	/** 存在這台電腦的哪一個。 */
	name: LayoutSize;
	/** 'y'：上下分，往上拖、按 ↑ 下面那一邊變大；'x'：左右分，往左拖、按 ← 右邊那一邊變大。 */
	axis: 'x' | 'y';
	/** 把拖的、按的大小夾在範圍內。 */
	clamp: (px: number) => number;
	/** 現在畫面上多大（沒拖過時是預設的大小）：從這裡開始拖、按方向鍵。 */
	size: () => number;
	/** 有給就照它的比例記（例如視窗寬）：大螢幕調過，換小螢幕時跟著縮，不會把另一邊擠到最小。 */
	relativeTo?: () => number;
}

export class Divider {
	/** 存的值：px，或 relativeTo 的比例；null = 預設（沒拖過，或雙擊回去了）。 */
	#stored = $state<number | null>(null);
	#opts: DividerOptions;
	/** 拖的時候：從哪裡開始拖、那時多大、那時存的值（按 Esc 回到它）、拿掉 Esc 監聽。 */
	#drag: { from: number; px: number; stored: number | null; offEscape: () => void } | null = null;

	constructor(opts: DividerOptions) {
		this.#opts = opts;
		this.#stored = loadLayoutPx(opts.name);
	}

	/** 拖過的大小（px）；null = 預設（沒拖過，或雙擊回去了）。 */
	get px(): number | null {
		const { relativeTo } = this.#opts;
		if (this.#stored === null || !relativeTo) return this.#stored;
		return Math.round(this.#stored * relativeTo());
	}

	/** 改大小（null = 回到預設），存在這台電腦。 */
	set(px: number | null) {
		const { relativeTo } = this.#opts;
		const clamped = px === null ? null : this.#opts.clamp(px);
		this.#stored = clamped === null || !relativeTo ? clamped : clamped / relativeTo();
		saveLayoutPx(this.#opts.name, this.#stored);
	}

	/** attachment：放在分界元素上，`{@attach divider.attach}`。 */
	attach = (el: HTMLElement) => {
		const { axis } = this.#opts;
		const at = (e: PointerEvent) => (axis === 'y' ? e.clientY : e.clientX);
		const bigger = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
		const smaller = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
		const end = () => {
			this.#drag?.offEscape();
			this.#drag = null;
		};
		const off = new AbortController();
		const opts = { signal: off.signal };
		el.addEventListener(
			'pointerdown',
			(e) => {
				if (e.button !== 0) return;
				this.#drag?.offEscape();
				const stored = this.#stored;
				// 拖到一半按 Esc：回到拖之前的大小
				const offEscape = onEscape(() => {
					this.#drag = null;
					this.#stored = stored;
					saveLayoutPx(this.#opts.name, stored);
				});
				this.#drag = { from: at(e), px: this.#opts.size(), stored, offEscape };
				el.setPointerCapture?.(e.pointerId);
			},
			opts
		);
		el.addEventListener(
			'pointermove',
			(e) => {
				if (this.#drag) this.set(this.#drag.px + this.#drag.from - at(e));
			},
			opts
		);
		el.addEventListener('pointerup', end, opts);
		el.addEventListener('pointercancel', end, opts);
		// 方向鍵自己用掉（preventDefault），頁面的方向鍵就不會去移播放頭
		el.addEventListener(
			'keydown',
			(e) => {
				const step = e.key === bigger ? KEY_STEP_PX : e.key === smaller ? -KEY_STEP_PX : 0;
				if (!step) return;
				e.preventDefault();
				this.set(this.#opts.size() + step);
			},
			opts
		);
		el.addEventListener('dblclick', () => this.set(null), opts);
		return () => {
			off.abort();
			end();
		};
	};
}
