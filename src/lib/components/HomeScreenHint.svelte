<script lang="ts">
	// 加到主畫面的提醒（#260、#191 借 B）：iPhone、iPad 的 Safari（不是從主畫面打開的）記成功率之後，從下面滑上來。
	// Safari 7 天沒打開這個網站就清掉網站存的資料（還沒傳的紀錄也在裡面），加到主畫面的不會。
	// 「知道了」以後不再跳；「下次再說」下次打開這支流程、記第一次再跳。不擋住畫面：記錄的按鈕照樣按得到（練習畫面下面留了它的高度）。
	import { m } from '#lib/paraglide/messages.js';

	interface Props {
		onknown: () => void;
		onlater: () => void;
		/** 它有多高（px）：練習畫面下面留這麼多，捲到底時按鈕不被它蓋住。 */
		height?: number;
	}
	let { onknown, onlater, height = $bindable(0) }: Props = $props();
	const id = $props.id();

	/** 量它多高（字換行跟著畫面寬，轉向、改大小時再量）。 */
	function measure(el: HTMLElement) {
		const update = () => (height = el.offsetHeight);
		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	}
</script>

<aside class="sheet" aria-labelledby="{id}-title" {@attach measure}>
	<h2 id="{id}-title">{m.account_home_screen_title()}</h2>
	<p>{m.account_home_screen_lead()}</p>
	<ol>
		<li>{m.account_home_screen_step_share()}</li>
		<li>{m.account_home_screen_step_add()}</li>
		<li>{m.account_home_screen_step_open()}</li>
	</ol>
	<div class="buttons">
		<button type="button" onclick={onlater}>{m.account_home_screen_later()}</button>
		<button type="button" class="primary" onclick={onknown}>{m.account_home_screen_got_it()}</button>
	</div>
</aside>

<style>
	.sheet {
		position: fixed;
		left: 50%;
		bottom: 0;
		z-index: 30;
		width: min(480px, 100%);
		box-sizing: border-box;
		display: grid;
		gap: 6px;
		padding: 14px 16px calc(14px + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		background: var(--surface);
		border: 1px solid var(--line);
		border-bottom: none;
		border-radius: 14px 14px 0 0;
		box-shadow: var(--shadow-pop);
		animation: slide-up 0.25s ease-out;
	}
	@keyframes slide-up {
		from {
			transform: translate(-50%, 100%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
	h2 {
		margin: 0;
		font-size: 16px;
	}
	p {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}
	ol {
		margin: 4px 0;
		padding-left: 20px;
		font-size: 14px;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	@media print {
		.sheet {
			display: none;
		}
	}
</style>
