<script lang="ts">
	// 忘記密碼頁（#190 的 A）：填 email、按「寄信」。不管有沒有帳號都回同一句話（伺服器也不說）。
	// 畫面不寫幾小時內有效：還沒設密碼的人收到的是設密碼信（24 小時），寫在信裡就好。
	// 從登入頁的「忘記密碼？」來時帶著 ?email=…。
	import { onMount } from 'svelte';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import { httpServer, type ServerAdapter } from '#lib/server-api.js';
	import { revealAlert } from '#lib/components/reveal.js';
	import { m } from '#lib/paraglide/messages.js';

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
	}
	let { server = httpServer() }: Props = $props();

	let email = $state('');
	/** 寄出去的 email（按了「寄信」之後）。 */
	let sentTo = $state<string | null>(null);
	let unreachable = $state(false);
	let busy = $state(false);

	onMount(() => {
		email = new URLSearchParams(location.search).get('email') ?? '';
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		unreachable = false;
		try {
			await server.forgotPassword(email.trim());
			sentTo = email.trim();
		} catch {
			unreachable = true;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{m.page_title({ page: m.forgot_password_title() })}</title></svelte:head>

<AccountCard>
	<form onsubmit={submit}>
		<h1>{m.forgot_password_title()}</h1>
		<p class="lead">{m.forgot_password_lead()}</p>
		<label class="field">
			<span>Email</span>
			<input type="email" autocomplete="username" required bind:value={email} />
		</label>
		{#if sentTo !== null}
			<p class="ok" role="status">{m.forgot_password_sent({ email: sentTo })}</p>
			<p class="hint">{m.forgot_password_spam_hint()}</p>
		{/if}
		{#if unreachable}<p class="error" {@attach revealAlert()}>{m.server_unreachable()}</p>{/if}
		<button type="submit" class="btn primary wide" disabled={busy}>{m.forgot_password_send()}</button>
	</form>
</AccountCard>
