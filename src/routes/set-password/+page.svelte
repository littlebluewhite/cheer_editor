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
	import { host } from '#lib/host.js';
	import { appDevice } from '#lib/app-shell.js';
	import { m } from '#lib/paraglide/messages.js';

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

<svelte:head><title>{m.page_title({ page: m.account_set_password() })}</title></svelte:head>

<AccountCard>
	{#if link === null}
		<h1>{m.account_link_gone_title()}</h1>
		<p class="lead">{m.account_link_gone_lead()}</p>
		<a class="btn primary wide" href={resolve('/forgot-password')}>{m.account_resend_email()}</a>
	{:else if link}
		<form onsubmit={submit}>
			<h1>{link.purpose === 'reset' ? m.account_set_new_password() : m.account_set_password()}</h1>
			<p class="lead">{link.purpose === 'reset' ? (host().shell.inApp ? m.account_reset_lead_app({ device: appDevice() }) : m.account_reset_lead()) : m.account_welcome({ name: link.name })}</p>
			<!-- email 顯示但不能改：讓密碼管理器知道是哪個帳號 -->
			<label class="field">
				<span>Email</span>
				<input type="email" autocomplete="username" readonly value={link.email} />
			</label>
			<label class="field" for="new-password">{m.account_password()}</label>
			<span class="with-show">
				<input id="new-password" type={show ? 'text' : 'password'} autocomplete="new-password" required bind:value={password} />
				<button type="button" class="btn ghost" aria-pressed={show} onclick={() => (show = !show)}><Icon name="eye" size={14} />{m.account_show()}</button>
			</span>
			<p class="count" class:enough={count >= MIN}>{m.account_password_count({ count, min: MIN })}</p>
			{#if problem && problem !== 'unreachable'}
				<p class="error" {@attach revealAlert()}>
					{problem.kind === 'breached'
						? m.account_password_breached()
						: (problem.missing === 1 ? m.account_password_short_one : m.account_password_short)({ n: problem.missing })}
				</p>
			{/if}
			{#if problem === 'unreachable'}<p class="error" {@attach revealAlert()}>{m.server_unreachable()}</p>{/if}
			<p class="hint">{m.account_password_any()}</p>
			<button type="submit" class="btn primary wide" disabled={busy}>{m.account_save_password()}</button>
		</form>
	{:else if problem === 'unreachable'}
		<p class="error" {@attach revealAlert()}>{m.server_unreachable()}</p>
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
