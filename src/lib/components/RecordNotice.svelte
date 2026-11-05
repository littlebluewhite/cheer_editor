<script module lang="ts">
	import type { CommandResult } from '#lib/core';
	import type { Ask } from '#lib/ask.svelte.js';
	import { UNDO_FLASH_MS, type Flash } from '#lib/flash.svelte.js';

	/** 記錄頁的提示：字（已存、已刪掉、已救回），刪掉之後帶著「救回」要做的事。 */
	export type Notice = { text: string; restore?: () => void };

	/**
	 * 刪掉上一次、救回（卡片和全上共用這一份）：經過 ask 送刪掉的指令，成功就提示 text（寫出刪了哪一次，例「已刪掉 ·✓（第 4 次）」），
	 * 旁邊有「救回」（留久一點）；按「救回」送 restore 拿刪掉的結果做的指令，成功就提示「已救回」。
	 */
	export function removeWithRestore<R extends CommandResult>(
		ask: Ask,
		notice: Flash<Notice>,
		text: string,
		remove: () => R,
		restore: (removed: Extract<R, { kind: 'ok' }>) => CommandResult
	) {
		ask.send(remove, {
			done: (removed) =>
				notice.show(
					{
						text,
						restore: () => ask.send(() => restore(removed), { done: () => notice.show({ text: '已救回' }) })
					},
					UNDO_FLASH_MS
				)
		});
	}
</script>

<script lang="ts">
	// 記錄頁的提示（卡片和上面全上那一排共用）：幾秒後收掉，滑鼠在上面時先不收；刪掉之後旁邊有「救回」。
	let { notice }: { notice: Flash<Notice> } = $props();
</script>

{#if notice.value}
	{@const restore = notice.value.restore}
	<!-- 刪掉的提示用中性色：綠字會被當成成功 -->
	<p
		class="notice"
		class:removed={!!restore}
		role="status"
		onpointerenter={() => notice.hold(true)}
		onpointerleave={() => notice.hold(false)}
	>
		{notice.value.text}{#if restore}<button type="button" class="ghost" onclick={restore}>救回</button>{/if}
	</p>
{/if}

<style>
	.notice {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		color: #15803d;
		font-size: 13px;
		font-weight: 700;
	}
	.notice.removed {
		color: var(--text);
	}
	.notice button {
		padding: 2px 8px;
		font-size: 13px;
		text-decoration: underline;
	}
</style>
