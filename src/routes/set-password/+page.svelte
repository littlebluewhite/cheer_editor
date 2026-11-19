<script lang="ts">
	// 設密碼頁（#190 的 A）：信裡的連結點進來，token 在 # 後面（不會送到伺服器的 log）。邀請和重設密碼同一頁。
	// 打開只看是誰，送出才用掉連結。設好不自動登入：跳登入頁、email 填好。
	// 連結不能用時「重寄一封信」到忘記密碼頁（邀請過期也走這條）。
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { charCount } from '#lib/core';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { httpServer, type LinkInfo, type PasswordProblem, type ServerAdapter } from '#lib/server-api.js';
	import { revealAlert } from '#lib/components/reveal.js';

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
		/** 設好後換頁；測試記下網址。 */
		go?: (url: string) => void;
	}
	let { server = httpServer(), go = (url) => location.assign(url) }: Props = $props();

	/** 跟伺服器一樣：至少 15 個看得到的字。 */
	const MIN = 15;

	let token = '';
	/** 連結：還在問是 undefined，不能用了是 null。 */
	let link = $state.raw<LinkInfo | null | undefined>(undefined);
	let password = $state('');
	let show = $state(false);
	let problem = $state.raw<PasswordProblem | 'unreachable' | null>(null);
	let busy = $state(false);
	const count = $derived(charCount(password));

	onMount(() => {
		token = location.hash.slice(1);
		server.passwordLink(token).then(
			(l) => (link = l),
			() => (problem = 'unreachable')
		);
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!link) return;
		busy = true;
		try {
			const result = await server.setPassword(token, password);
			if (result === 'ok') {
				return go(`${resolve('/login')}?${new URLSearchParams({ email: link.email, passwordSet: '1' })}`);
			}
			if (result === 'gone') link = null;
			else problem = result;
		} catch {
			problem = 'unreachable';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>設密碼 — 流程編輯器</title></svelte:head>

<AccountCard>
	{#if link === null}
		<h1>這個連結不能用了</h1>
		<p class="lead">可能超過時間（邀請 24 小時、重設密碼 1 小時），或已經用過了。</p>
		<a class="btn primary wide" href={resolve('/forgot-password')}>重寄一封信</a>
	{:else if link}
		<form onsubmit={submit}>
			<h1>{link.purpose === 'reset' ? '設新密碼' : '設密碼'}</h1>
			<p class="lead">{link.purpose === 'reset' ? '設好後，你在其他裝置都會登出。' : `${link.name}，歡迎！設好密碼就能登入。`}</p>
			<!-- email 顯示但不能改：讓密碼管理器知道是哪個帳號 -->
			<label class="field">
				<span>Email</span>
				<input type="email" autocomplete="username" readonly value={link.email} />
			</label>
			<label class="field" for="new-password">密碼</label>
			<span class="with-show">
				<input id="new-password" type={show ? 'text' : 'password'} autocomplete="new-password" required bind:value={password} />
				<button type="button" class="btn ghost" aria-pressed={show} onclick={() => (show = !show)}><Icon name="eye" size={14} />顯示</button>
			</span>
			<p class="count" class:enough={count >= MIN}>{count}／至少 {MIN} 個字</p>
			{#if problem && problem !== 'unreachable'}
				<p class="error" {@attach revealAlert()}>
					{problem.kind === 'tooShort' ? `還差 ${problem.missing} 個字。` : '這個密碼太常見，或在別的網站外洩過。換一個。'}
				</p>
			{/if}
			{#if problem === 'unreachable'}<p class="error" {@attach revealAlert()}>連不上伺服器，請稍後再試。</p>{/if}
			<p class="hint">可以是一句話，空白、中文都算字。可以用密碼管理器。</p>
			<button type="submit" class="btn primary wide" disabled={busy}>設好密碼</button>
		</form>
	{:else if problem === 'unreachable'}
		<p class="error" {@attach revealAlert()}>連不上伺服器，請稍後再試。</p>
	{/if}
</AccountCard>

<style>
	.count {
		margin-top: -4px;
		font-size: 12px;
		color: var(--muted);
	}
	.count.enough {
		color: #2b7a2f;
	}
</style>
