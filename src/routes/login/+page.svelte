<script lang="ts">
	// 登入頁（#190 的 A）：Email、密碼（「顯示」）、登入。設好密碼跳來時帶著 ?email=…&passwordSet=1：綠色一行、email 填好。
	// 試太多次（鎖住）說要等多久，照樣能按「忘記密碼？」；登入超過 30 天被登出時，上面黃色一行（#246），
	// 這台還有沒傳的成功率紀錄時加一句幾筆、登入後會自動傳（#260）。
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { httpServer, tooManyTriesText, type ServerAdapter, type TooManyTries } from '#lib/server-api.js';
	import { createIndexedDbOfflineStore, unsentCount, type OfflineStore } from '#lib/offline-store.js';

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
		/** 登入後換頁；測試記下網址。 */
		go?: (url: string) => void;
		/** 離線存放（#260）：這台還有幾筆沒傳；測試放假的。 */
		offline?: OfflineStore;
	}
	let { server = httpServer(), go = (url) => location.assign(url), offline = createIndexedDbOfflineStore() }: Props = $props();

	let email = $state('');
	let password = $state('');
	let show = $state(false);
	let passwordSet = $state(false);
	let expired = $state(false);
	/** 這台還有幾筆成功率紀錄沒傳。 */
	let unsent = $state(0);
	let error = $state.raw<'wrong' | 'unreachable' | TooManyTries | null>(null);
	let busy = $state(false);
	/** 忘記密碼頁，帶著打好的 email。 */
	const forgotHref = $derived(resolve('/forgot-password') + (email.trim() ? `?${new URLSearchParams({ email: email.trim() })}` : ''));

	onMount(() => {
		const q = new URLSearchParams(location.search);
		email = q.get('email') ?? '';
		passwordSet = q.get('passwordSet') === '1';
		server.loginExpired().then((e) => (expired = e));
		offline.unsent().then((list) => (unsent = list.reduce((n, u) => n + unsentCount(u), 0)));
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const result = await server.login(email, password);
			if (result === 'ok') return go(resolve('/'));
			error = result;
		} catch {
			error = 'unreachable';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>登入 — 流程編輯器</title></svelte:head>

<AccountCard>
	<form onsubmit={submit}>
		<h1>登入</h1>
		{#if passwordSet}<p class="ok" role="status">密碼設好了，請用新密碼登入。</p>
		{:else if expired}<p class="warn" role="status">
				登入超過 30 天了，請再登入一次。{#if unsent}這台還有 {unsent} 筆成功率紀錄沒傳，登入後會自動傳。{/if}</p
			>{/if}
		<label class="field">
			<span>Email</span>
			<input type="email" autocomplete="username" required bind:value={email} />
		</label>
		<label class="field" for="login-password">密碼</label>
		<span class="with-show">
			<input id="login-password" type={show ? 'text' : 'password'} autocomplete="current-password" required bind:value={password} />
			<button type="button" class="btn ghost" aria-pressed={show} onclick={() => (show = !show)}><Icon name="eye" size={14} />顯示</button>
		</span>
		{#if error === 'wrong'}
			<p class="error" role="alert"><b>email 或密碼不對</b><small>一直進不去？請找管理員。</small></p>
		{:else if error === 'unreachable'}
			<p class="error" role="alert">連不上伺服器，請稍後再試。</p>
		{:else if error}
			<p class="error" role="alert"><b>{tooManyTriesText(error)}</b><small>忘記密碼的話，按『忘記密碼』重設。</small></p>
		{/if}
		<button type="submit" class="btn primary wide" disabled={busy}>登入</button>
		<a class="forgot" href={forgotHref}>忘記密碼？</a>
		<p class="hint">沒有帳號？請管理員加你。</p>
		<p class="hint">不登入也能用：<a href={resolve('/')}>回首頁</a>，流程只存在這台電腦。</p>
	</form>
</AccountCard>

<style>
	.forgot {
		justify-self: center;
		font-size: 13px;
	}
</style>
