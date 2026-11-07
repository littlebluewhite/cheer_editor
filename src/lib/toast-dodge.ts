// 場地上的提示和確認框平常疊在場地上方；選到的人、正在拖的人站在那裡時，換到場地下方，不蓋住他。
// 要量版面（jsdom 量不到，見 ADR 0002），由 scripts/check-layout.mjs 檢查。

import type { Attachment } from 'svelte/attachments';

/** 放在上方時離場地上緣多遠（跟 +page.svelte 的 .field-toasts 的 top 一樣）。 */
export const TOASTS_TOP_PX = 14;
/** 提示下面多留一點，人剛好擦邊也算蓋住。 */
const MARGIN_PX = 8;

/**
 * attachment：放在場地上的提示那一層，`{@attach dodgeSelected(() => [依賴…])}`。
 * watch 讀到的東西變了（提示、選取、播放頭…）就重量一次；拖人時跟著指標重量。
 * 放在上方會蓋住選到的人、正在拖的人時，這一層加 class `below`（樣式由用的地方給：換到下方）。
 */
export function dodgeSelected(watch: () => unknown): Attachment<HTMLElement> {
	return (el) => {
		watch();
		const measure = () => {
			const host = el.parentElement;
			const kids = [...el.children].map((c) => c.getBoundingClientRect());
			if (!host || !kids.length) return void el.classList.remove('below');
			// 放在上方時佔的範圍：場地上緣到提示下緣；左右在上在下都一樣（置中）
			const left = Math.min(...kids.map((r) => r.left));
			const right = Math.max(...kids.map((r) => r.right));
			// 選人工具列出現時，上方的提示排在它下面（--tools-h）
			const tools = parseFloat(getComputedStyle(host).getPropertyValue('--tools-h')) || 0;
			const bottom = host.getBoundingClientRect().top + TOASTS_TOP_PX + tools + el.offsetHeight + MARGIN_PX;
			const covered = [...host.querySelectorAll('.dot.selected, .dot.dragging')].some((d) => {
				const r = d.getBoundingClientRect();
				return r.left < right && left < r.right && r.top < bottom;
			});
			el.classList.toggle('below', covered);
		};
		const frame = requestAnimationFrame(measure);
		window.addEventListener('pointermove', measure, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('pointermove', measure);
		};
	};
}
