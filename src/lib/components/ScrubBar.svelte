<script lang="ts">
	// 檢視畫面的進度條（#330）：一條細條代表整支流程，手指按住拖移動播放頭，放開對齊最近的八拍開頭。
	// 只是看：不改流程。跳轉走 onseek（頁面給 playback.seek）；播放中按住先停、放開接著播，停著拖完照樣停。
	import { nearestEightStart, totalSeconds, type Flow } from '#lib/core';
	import { m } from '#lib/paraglide/messages.js';
	import { followPointer } from './pointer.js';

	interface Props {
		flow: Flow;
		/** 播放頭在第幾秒。 */
		sec: number;
		/** 讀螢幕軟體念的位置（跟「目前位置」一樣：段名和「3-1」）。 */
		valuetext: string;
		/** 拖的時候浮在指頭上面的字（「3-1」）。 */
		tip: string;
		onseek: (sec: number) => void;
		/** 正在播放嗎：按下時在播，按著的時候先停（onpause，播放頭留在手指那裡），放開接著播（onplay）。 */
		playing: boolean;
		onplay: () => void;
		onpause: () => void;
		/** 指標位置換成進度條的幾分之幾（0 到 1）：預設用瀏覽器算；jsdom 不算版面，測試換成假的（ADR 0002）。 */
		fractionAt?: (bar: HTMLElement, clientX: number) => number;
	}

	let { flow, sec, valuetext, tip, onseek, playing, onplay, onpause, fractionAt = fromRect }: Props = $props();

	/** 拖的時候最多到結尾前幾秒（比播放算「到結尾了」的誤差大）。 */
	const BEFORE_END_SEC = 0.1;

	let bar: HTMLElement;
	let dragging = $state(false);
	const total = $derived(totalSeconds(flow));

	function fromRect(el: HTMLElement, clientX: number): number {
		const r = el.getBoundingClientRect();
		return r.width ? (clientX - r.left) / r.width : 0;
	}

	function start(e: PointerEvent) {
		// 拖的時候第二根手指按到：不搶走第一根
		if (e.button !== 0 || !total || dragging) return;
		e.preventDefault();
		// 拖到最右邊停在結尾前一點點：跳到結尾算播完，播放中會停下（放開反正對齊八拍開頭，不會停在那裡）
		const toSec = (ev: PointerEvent) => Math.min(Math.max(fractionAt(bar, ev.clientX), 0) * total, total - BEFORE_END_SEC);
		let at = toSec(e);
		// 播放中按住：先停，播放頭留在手指那裡（不然按著不動也一直往前跑）；放開照樣接著播
		const wasPlaying = playing;
		if (wasPlaying) onpause();
		const done = () => {
			dragging = false;
			onseek(nearestEightStart(flow, at));
			if (wasPlaying) onplay();
		};
		dragging = true;
		onseek(at);
		followPointer(
			e,
			(ev) => {
				at = toSec(ev);
				onseek(at);
			},
			done,
			done
		);
	}
</script>

<!-- 方向鍵移播放頭是頁面的快捷鍵（一拍，Shift 一個八拍）：停在進度條上照樣能用，這裡不另外接 -->
<div
	class="scrub"
	role="slider"
	tabindex="0"
	aria-label={m.editor_scrub()}
	aria-valuemin={0}
	aria-valuemax={Math.round(total * 10) / 10}
	aria-valuenow={Math.round(sec * 10) / 10}
	aria-valuetext={valuetext}
	style:--at="{total ? (Math.min(sec, total) / total) * 100 : 0}%"
	bind:this={bar}
	onpointerdown={start}
	><span class="track"><span class="fill"></span></span><span class="thumb"></span>{#if dragging}<span class="tip">{tip}</span>{/if}</div
>

<style>
	/* 佔的高度只有 10px（手機直拿時場地的高度很緊，見 check-layout 的「一公尺至少畫 13 px」）；摸得到的範圍往上多 10px，
	   蓋在場地框外圍的空白上（::before），一共 20px。畫出來的條只有 4px；左右留一點，頭（圓點）在兩端也整個看得到 */
	.scrub {
		position: relative;
		height: 10px;
		margin-inline: 14px;
		touch-action: none;
		cursor: pointer;
	}
	.scrub::before {
		content: '';
		position: absolute;
		inset: -10px 0 0;
	}
	.track {
		position: absolute;
		left: 0;
		right: 0;
		top: 3px;
		height: 4px;
		border-radius: 2px;
		background: #36425f;
		overflow: hidden;
	}
	.fill {
		display: block;
		width: var(--at);
		height: 100%;
		background: var(--now);
	}
	.thumb {
		position: absolute;
		top: -1px;
		left: var(--at);
		width: 12px;
		height: 12px;
		margin-left: -6px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}
	.scrub:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
		border-radius: 4px;
	}
	/* 拖的時候：指頭上面寫第幾個八拍，手指不會蓋住 */
	.tip {
		position: absolute;
		bottom: calc(100% + 8px);
		/* 拖到兩端時小框不出畫面 */
		left: clamp(20px, var(--at), calc(100% - 20px));
		transform: translateX(-50%);
		padding: 2px 8px;
		border-radius: 6px;
		background: #fff;
		color: var(--ink);
		font-size: 14px;
		font-weight: 700;
		white-space: nowrap;
		pointer-events: none;
	}
</style>
