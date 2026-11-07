<script lang="ts">
	// 帳號選單「名字 ▾」：上面一行 email，下面「登出」。放在首頁和帳號的頁面，不放編輯頁的上方列（#190）。
	// 「我的帳號」（#246）、「管理使用者」（#245，只有管理員有）之後加在登出上面。
	import type { Me } from '#lib/server-api.js';
	import { below, popover } from '#lib/popover.svelte.js';

	interface Props {
		me: Me;
		onlogout: () => void;
	}
	let { me, onlogout }: Props = $props();

	let open = $state(false);
	let button = $state<HTMLButtonElement>();
	const uid = $props.id();

	function close(by: 'outside' | 'escape') {
		open = false;
		if (by === 'escape') button?.focus();
	}
</script>

<div class="account">
	<button
		bind:this={button}
		type="button"
		class="btn ghost"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="{uid}-menu"
		onclick={() => (open = !open)}>{me.name} ▾</button
	>
	{#if open}
		<div
			class="menu"
			role="menu"
			id="{uid}-menu"
			aria-label={me.name}
			{@attach popover({ place: below(button!, { gap: 4, align: 'right', flip: false }), close, inside: [button] })}
		>
			<div class="who">{me.email}</div>
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					open = false;
					onlogout();
				}}>登出</button
			>
		</div>
	{/if}
</div>

<style>
	.menu {
		position: fixed;
		inset: auto;
		margin: 0;
		z-index: 20;
		min-width: 180px;
		display: grid;
		padding: 6px;
		color: inherit;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		box-shadow: var(--shadow-pop);
	}
	.menu button {
		justify-content: flex-start;
		border: none;
		background: none;
		text-align: left;
	}
	.menu button:hover {
		background: var(--surface-2);
	}
	.who {
		padding: 4px 10px 6px;
		border-bottom: 1px solid var(--line-soft);
		margin-bottom: 4px;
		color: var(--muted);
		font-size: 12px;
		overflow-wrap: anywhere;
	}
</style>
