// 場地上的提示和確認框放哪：不蓋住標了 [data-keep-visible] 的東西（場上的人、條號、「正面／裁判」、位置文字、選人工具列…）。
// 不寫死要躲誰：要一直看得到的東西自己標 data-keep-visible，這裡照畫面上量到的位置找一個空的地方。
// 先試上面那一列（場地上緣，選人工具列那一條），再試工具列下面、場地下面；每一列試置中、靠右、靠左。
// 要量版面（jsdom 量不到，見 ADR 0002）：怎麼挑位置是 placeToasts（純函式，有單元測試），量和擺由 scripts/check-layout.mjs 檢查。

import type { Attachment } from 'svelte/attachments';

/** 畫面上的一個框（px）。 */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}
/** 擋路的東西和蓋到它有多糟：選到的人、正在拖的人、選人工具列很糟（寧可蓋別的）。 */
export interface Obstacle {
	rect: Box;
	weight: number;
}

/** 提示離場地邊緣、離工具列多遠。 */
const GAP_PX = 4;
/** 蓋到選到的人、正在拖的人、選人工具列有多糟（一般的人、條號是 1）。 */
const HEAVY = 100;

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * 提示那一層（寬 size.width、高 size.height）放在 area 裡的哪裡：rows 是可以放的上緣，由前往後試；
 * 每一列試置中、靠右、靠左（比 area 還寬就只能置中）。第一個不蓋到任何東西的就用；都會蓋到，用蓋到最少（加權）的。
 */
export function placeToasts(
	size: { width: number; height: number },
	area: Box,
	rows: number[],
	obstacles: Obstacle[]
): { left: number; top: number } {
	const center = area.left + (area.right - area.left - size.width) / 2;
	const fits = size.width + 2 * GAP_PX <= area.right - area.left;
	const xs = fits ? [center, area.right - GAP_PX - size.width, area.left + GAP_PX] : [center];
	let best = { left: center, top: rows[0], cost: Infinity };
	for (const top of rows)
		for (const left of xs) {
			const spot = { left, top, right: left + size.width, bottom: top + size.height };
			const cost = obstacles.reduce((sum, o) => sum + (overlaps(spot, o.rect) ? o.weight : 0), 0);
			if (cost === 0) return { left, top };
			if (cost < best.cost) best = { left, top, cost };
		}
	return { left: best.left, top: best.top };
}

/**
 * attachment：放在場地上的提示那一層（場地那一塊 .stage 的子元素），`{@attach dodgeKeepVisible(() => [依賴…])}`。
 * watch 讀到的東西變了（提示、選取、播放頭…）就重量一次；拖人時跟著指標重量。
 * 量提示那一層攤開時多大，在場地那一塊裡找不蓋住 [data-keep-visible] 的地方，用 left、top、width 擺過去。
 */
export function dodgeKeepVisible(watch: () => unknown): Attachment<HTMLElement> {
	return (el) => {
		watch();
		const measure = () => {
			const host = el.parentElement;
			if (!host) return;
			// 先攤開（樣式給的整個寬）量它要多大
			el.style.removeProperty('left');
			el.style.removeProperty('top');
			el.style.removeProperty('width');
			const kids = [...el.children].map((c) => c.getBoundingClientRect());
			if (!kids.length) return;
			const size = {
				width: Math.max(...kids.map((r) => r.right)) - Math.min(...kids.map((r) => r.left)),
				height: el.offsetHeight
			};
			const h = host.getBoundingClientRect();
			const area = { left: h.left, top: h.top, right: h.right, bottom: h.bottom };
			const keep = [...host.querySelectorAll('[data-keep-visible]')].filter((k) => !el.contains(k));
			const obstacles = keep.map((k) => ({
				rect: k.getBoundingClientRect(),
				weight: k.matches('.selected, .dragging, [role="toolbar"]') ? HEAVY : 1
			}));
			const tools = host.querySelector('[role="toolbar"]')?.getBoundingClientRect();
			const rows = [area.top + GAP_PX, ...(tools ? [tools.bottom + GAP_PX] : []), area.bottom - GAP_PX - size.height];
			const at = placeToasts(size, area, rows, obstacles);
			el.style.left = `${at.left - h.left}px`;
			el.style.top = `${at.top - h.top}px`;
			el.style.width = `${size.width}px`;
		};
		const frame = requestAnimationFrame(measure);
		window.addEventListener('pointermove', measure, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('pointermove', measure);
		};
	};
}
