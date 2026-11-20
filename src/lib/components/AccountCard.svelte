<script lang="ts">
	// 登入、設密碼、忘記密碼、我的帳號的頁面：上面一條（左邊網站名字回首頁；右邊沒登入時「回首頁」、
	// 登入了是帳號選單），中間一張卡片（#190 的 A）。
	// 卡片裡的表單長一樣：欄位、密碼的「顯示」、錯誤、提示的樣子都在這裡。
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import AccountMenu from '#lib/components/AccountMenu.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import type { Me } from '#lib/server-api.js';

	interface Props {
		children: Snippet;
		/** 登入的是誰：給了右上角放帳號選單，沒給放「回首頁」。 */
		me?: Me | null;
		onlogout?: () => void;
		/** wide：管理使用者那種一張表的頁，卡片放寬。 */
		wide?: boolean;
	}
	let { children, me = null, onlogout = () => {}, wide = false }: Props = $props();
</script>

<div class="page">
	<header class="top">
		<a class="brand" href={resolve('/')}>{m.app_name()}</a>
		{#if me}
			<AccountMenu {me} {onlogout} />
		{:else}
			<a class="btn ghost" href={resolve('/')}><Icon name="home" />{m.back_home()}</a>
		{/if}
	</header>
	<main class="card" class:wide>
		{@render children()}
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 16px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	.top a {
		text-decoration: none;
	}
	.brand {
		font-weight: 700;
		color: var(--mat-deep);
	}
	.card {
		width: min(400px, calc(100% - 32px));
		margin: 48px auto;
		padding: 24px;
		background: var(--surface);
		border-radius: 12px;
		box-shadow: var(--shadow-pop);
	}
	.card.wide {
		width: min(960px, calc(100% - 32px));
	}
	.card :global(form) {
		display: grid;
		gap: 10px;
	}
	.card :global(h1) {
		font-size: 20px;
	}
	.card :global(.lead),
	.card :global(.hint) {
		color: var(--ink-3);
	}
	.card :global(.hint) {
		font-size: 13px;
	}
	.card :global(.field) {
		display: grid;
		gap: 4px;
		font-size: 13px;
		font-weight: 600;
	}
	.card :global(.field input) {
		font-weight: 400;
		font-size: 15px;
		padding: 8px 10px;
	}
	.card :global(.with-show) {
		display: flex;
		gap: 6px;
	}
	.card :global(.with-show input) {
		flex: 1;
		min-width: 0;
	}
	.card :global(.wide) {
		width: 100%;
		padding: 8px 10px;
		font-size: 14px;
		justify-content: center;
	}
	.card :global(.error) {
		display: grid;
		gap: 2px;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 13px;
	}
	.card :global(.error small) {
		color: var(--ink-3);
		font-size: 12px;
	}
	.card :global(.warn) {
		padding: 8px 10px;
		border-radius: 8px;
		background: #fff4d6;
		color: #7a5300;
		font-size: 13px;
	}
	.card :global(.ok) {
		padding: 8px 10px;
		border-radius: 8px;
		background: #e6f4ea;
		color: #1e6b34;
		font-size: 13px;
	}
</style>
