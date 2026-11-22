<script lang="ts">
	// App 裡雲端流程被新版擋住時寫什麼、給什麼按鈕（#394，#lib/app-update.svelte.js）：
	// 這個殼太舊寫「這版 App 太舊」＋開 App Store；不然寫「有新版」（或 text）＋「更新」。檢視模式那塊、手機的那一行、練習頁的提示條共用。
	import { APP_STORE_URL, type AppUpdate } from '#lib/app-update.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { m } from '#lib/paraglide/messages.js';

	interface Props {
		update: AppUpdate;
		/** 開著的雲端流程：換完回到這支。 */
		flowId: string;
		/** 「有新版」那句換成這句（練習頁寫記的怎麼辦）。 */
		text?: string;
	}
	let { update, flowId, text }: Props = $props();
	const session = getEditorSession();

	async function press() {
		if (await update.update(flowId)) return;
		if (update.status === 'none') session.notice = m.app_update_failed();
	}
</script>

{#if update.status === 'tooOld'}
	<span>{m.app_too_old()}</span>
	{#if APP_STORE_URL}
		<a class="app-update" href={APP_STORE_URL} target="_blank" rel="noopener" role="button">{m.app_open_app_store()}</a>
	{:else}
		<!-- 上架後才有網址（APP_STORE_URL） -->
		<button type="button" class="app-update" disabled>{m.app_open_app_store()}</button>
	{/if}
{:else}
	<span>{text ?? m.app_new_version()}</span>
	<button type="button" class="app-update" disabled={update.status === 'updating'} onclick={press}
		>{update.status === 'updating' ? m.app_updating() : m.app_update()}</button
	>
{/if}

<style>
	.app-update {
		/* 檢視模式那塊整塊不接點按（pointer-events: none），按鈕自己接 */
		pointer-events: auto;
		padding: 2px 10px;
		border: 1px solid currentColor;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.app-update:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
