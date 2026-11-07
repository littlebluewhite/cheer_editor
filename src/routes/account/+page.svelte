<script lang="ts">
	// 我的帳號（#190）：名字（自己改）、Email 只顯示、改密碼（現在的密碼、新密碼）、「登出這台裝置」。
	// 沒登入就到登入頁。
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { charCount } from '#lib/core';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import {
		httpServer,
		tooManyTriesText,
		type ChangePasswordResult,
		type Me,
		type ServerAdapter
	} from '#lib/server-api.js';

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
		/** 換頁；測試記下網址。 */
		go?: (url: string) => void;
	}
	let { server = httpServer(), go = (url) => location.assign(url) }: Props = $props();

	/** 跟伺服器一樣：至少 15 個看得到的字。 */
	const MIN = 15;

	/** 登入的是誰：還在問是 undefined。 */
	let me = $state.raw<Me | null | undefined>(undefined);
	let name = $state('');
	let nameResult = $state<'ok' | 'unreachable' | null>(null);
	let current = $state('');
	let password = $state('');
	let showCurrent = $state(false);
	let showNew = $state(false);
	let passwordResult = $state.raw<ChangePasswordResult | 'unreachable' | null>(null);
	let busy = $state(false);
	const count = $derived(charCount(password));

	onMount(() => {
		server.me().then((m) => {
			if (!m) return go(resolve('/login'));
			me = m;
			name = m.name;
		});
	});

	async function changeName(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const changed = await server.changeName(name);
			if (!changed) return go(resolve('/login'));
			me = changed;
			name = changed.name;
			nameResult = 'ok';
		} catch {
			nameResult = 'unreachable';
		} finally {
			busy = false;
		}
	}

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			passwordResult = await server.changePassword(current, password);
			if (passwordResult === 'ok') current = password = '';
		} catch {
			passwordResult = 'unreachable';
		} finally {
			busy = false;
		}
	}

	/** 改密碼沒改成的原因。 */
	function problemText(r: Exclude<ChangePasswordResult, 'ok'> | 'unreachable'): string {
		if (r === 'unreachable') return '連不上伺服器，請稍後再試。';
		if (r === 'wrong') return '現在的密碼不對。';
		if ('retryAfter' in r) return tooManyTriesText(r);
		return r.kind === 'tooShort' ? `還差 ${r.missing} 個字。` : '這個密碼太常見，或在別的網站外洩過。換一個。';
	}

	/** 登出這台裝置，回首頁。連不上伺服器時還是登入著（可以再按一次）。 */
	async function logout() {
		try {
			await server.logout();
			go(resolve('/'));
		} catch {
			// 沒登出成功：什麼都不變
		}
	}
</script>

<svelte:head><title>我的帳號 — 流程編輯器</title></svelte:head>

<AccountCard {me} onlogout={logout}>
	{#if me}
		<div class="account">
			<h1>我的帳號</h1>
			<section aria-label="名字">
				<form onsubmit={changeName}>
					<label class="field">
						<span>名字</span>
						<input required bind:value={name} oninput={() => (nameResult = null)} />
					</label>
					<p class="hint">別人在分享名單、成功率紀錄上看到的名字</p>
					{#if nameResult === 'ok'}<p class="ok" role="status">名字改好了。</p>{/if}
					{#if nameResult === 'unreachable'}<p class="error" role="alert">連不上伺服器，請稍後再試。</p>{/if}
					<button type="submit" class="btn" disabled={busy || !name.trim()}>改名字</button>
				</form>
			</section>

			<label class="field">
				<span>Email</span>
				<input type="email" autocomplete="username" readonly value={me.email} />
			</label>
			<p class="hint">要改 email 請找管理員</p>

			<section aria-labelledby="change-password">
				<form onsubmit={changePassword}>
					<h2 id="change-password">改密碼</h2>
					<label class="field" for="current-password">現在的密碼</label>
					<span class="with-show">
						<input id="current-password" type={showCurrent ? 'text' : 'password'} autocomplete="current-password" required bind:value={current} />
						<button type="button" class="btn ghost" aria-pressed={showCurrent} onclick={() => (showCurrent = !showCurrent)}><Icon name="eye" size={14} />顯示</button>
					</span>
					<label class="field" for="new-password">新密碼</label>
					<span class="with-show">
						<input id="new-password" type={showNew ? 'text' : 'password'} autocomplete="new-password" required bind:value={password} />
						<button type="button" class="btn ghost" aria-pressed={showNew} onclick={() => (showNew = !showNew)}><Icon name="eye" size={14} />顯示</button>
					</span>
					<p class="count" class:enough={count >= MIN}>{count}／至少 {MIN} 個字</p>
					<p class="hint">改好後，你在其他裝置都會登出</p>
					{#if passwordResult === 'ok'}
						<p class="ok" role="status">密碼改好了。</p>
					{:else if passwordResult}
						<p class="error" role="alert">{problemText(passwordResult)}</p>
					{/if}
					<button type="submit" class="btn" disabled={busy}>改密碼</button>
				</form>
			</section>

			<button type="button" class="btn wide" onclick={logout}>登出這台裝置</button>
		</div>
	{/if}
</AccountCard>

<style>
	.account {
		display: grid;
		gap: 10px;
	}
	section {
		padding-bottom: 14px;
		border-bottom: 1px solid var(--line-soft);
	}
	h2 {
		font-size: 15px;
	}
	form .btn:not(.ghost) {
		justify-self: start;
	}
	.count {
		margin-top: -4px;
		font-size: 12px;
		color: var(--muted);
	}
	.count.enough {
		color: #2b7a2f;
	}
</style>
