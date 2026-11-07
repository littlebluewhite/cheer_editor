<script lang="ts">
	// 編輯器唯一的提示（session.notice）：同時只有一則，新的取代舊的，幾秒後自己收掉（滑鼠在上面時先不收）。
	// 可以帶一個按鈕（「復原」「救回」）。浮在畫面上（position: absolute），出現、收掉都不推動版面。
	// 練習畫面、手機的檢視畫面放在下方；編輯畫面場地上的由頁面放在上方（見頁面的 .field-toasts）。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import Icon from './Icon.svelte';

	/** onundo：提示的按鈕沒給 run 時按了做什麼（頁面的復原）；沒給就是 session 的復原。 */
	let { onundo }: { onundo?: () => void } = $props();

	const session = getEditorSession();
</script>

{#if session.notice}
	<div
		class="toast"
		role="presentation"
		onpointerenter={() => session.holdNotice(true)}
		onpointerleave={() => session.holdNotice(false)}
	>
		<span role="status">{session.notice}</span>
		{#if session.noticeButton}
			{@const button = session.noticeButton}
			<button
				type="button"
				class="ghost undo"
				aria-label={button.name}
				onclick={button.run ?? onundo ?? (() => session.undo())}>{button.label}</button
			>
		{/if}
		<button type="button" class="ghost icon" aria-label="收起提示" onclick={() => (session.notice = '')}
			><Icon name="close" size={14} /></button
		>
	</div>
{/if}

<style>
	.toast {
		position: absolute;
		bottom: 14px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: min(560px, calc(100% - 32px));
		padding: 6px 6px 6px 14px;
		border-radius: 10px;
		background: var(--ink);
		color: #fff;
		font-size: 13px;
		box-shadow: var(--shadow-pop);
		animation: drop 0.18s ease-out;
	}
	.toast button {
		color: #b8c3da;
		width: 24px;
		height: 24px;
	}
	.toast .undo {
		width: auto;
		padding: 0 8px;
		color: #fff;
		font-weight: 700;
		text-decoration: underline;
	}
	.toast button:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translate(-50%, 6px);
		}
	}
	@media print {
		.toast {
			display: none;
		}
	}
</style>
