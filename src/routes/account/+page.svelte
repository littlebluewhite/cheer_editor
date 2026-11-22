<script lang="ts">
	// 我的帳號（#190）：名字（自己改）、Email 只顯示、改密碼（現在的密碼、新密碼）、「登出這台裝置」。
	// 這台還有沒傳的成功率紀錄時，登出先跳小框（#260）。
	// 沒登入就到登入頁。
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { charCount } from '#lib/core';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import UnsentLogout from '#lib/components/UnsentLogout.svelte';
	import { host } from '#lib/host.js';
	import { unsentFlows, type OfflineStore, type UnsentRecords } from '#lib/offline-store.js';
	import {
		httpServer,
		tooManyTriesText,
		type ChangePasswordResult,
		type Me,
		type ServerAdapter
	} from '#lib/server-api.js';
	import { revealAlert } from '#lib/components/reveal.js';
	import { m } from '#lib/paraglide/messages.js';

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
		/** 換頁；測試記下網址。 */
		go?: (url: string) => void;
		/** 離線存放（#260）：登出前看這台還有沒有沒傳的紀錄；測試放假的。 */
		offline?: OfflineStore;
	}
	let { server = httpServer(), go = (url) => location.assign(url), offline = host().createOfflineStore() }: Props = $props();

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
		server.me().then((who) => {
			if (!who) return go(resolve('/login'));
			me = who;
			name = who.name;
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
		if (r === 'unreachable') return m.server_unreachable();
		if (r === 'wrong') return m.account_wrong_password();
		if ('retryAfter' in r) return tooManyTriesText(r);
		if (r.kind === 'breached') return m.account_password_breached();
		return (r.missing === 1 ? m.account_password_short_one : m.account_password_short)({ n: r.missing });
	}

	/** 登出前發現這台還有沒傳的紀錄（#260）：小框列每支流程幾筆；沒有是 null。 */
	let unsentAtLogout = $state.raw<UnsentRecords[] | null>(null);
	/** 按登出：這台還有沒傳的紀錄就先問（小框），沒有就登出。 */
	async function logout() {
		const left = await unsentFlows(offline);
		if (left.length) unsentAtLogout = left;
		else await signOut();
	}
	/** 登出這台裝置（discard：先丟掉這台沒傳的紀錄），回首頁。連不上伺服器時還是登入著（可以再按一次）。 */
	async function signOut(discard = false) {
		unsentAtLogout = null;
		try {
			await server.logout();
			if (discard) await offline.clearUnsent();
			// 離線副本跟著帳號：登出就清掉（#261）
			await offline.clearCopies();
			go(resolve('/'));
		} catch {
			// 沒登出成功：什麼都不變
		}
	}
</script>

<svelte:head><title>{m.page_title({ page: m.account_title() })}</title></svelte:head>

<AccountCard {me} onlogout={logout}>
	{#if me}
		<div class="account">
			<h1>{m.account_title()}</h1>
			<section aria-label={m.account_name()}>
				<form onsubmit={changeName}>
					<label class="field">
						<span>{m.account_name()}</span>
						<input required bind:value={name} oninput={() => (nameResult = null)} />
					</label>
					<p class="hint">{m.account_name_hint()}</p>
					{#if nameResult === 'ok'}<p class="ok" role="status">{m.account_name_saved()}</p>{/if}
					{#if nameResult === 'unreachable'}<p class="error" {@attach revealAlert()}>{m.server_unreachable()}</p>{/if}
					<button type="submit" class="btn" disabled={busy || !name.trim()}>{m.account_change_name()}</button>
				</form>
			</section>

			<label class="field">
				<span>Email</span>
				<input type="email" autocomplete="username" readonly value={me.email} />
			</label>
			<p class="hint">{m.account_email_hint()}</p>

			<section aria-labelledby="change-password">
				<form onsubmit={changePassword}>
					<h2 id="change-password">{m.account_change_password()}</h2>
					<label class="field" for="current-password">{m.account_current_password()}</label>
					<span class="with-show">
						<input id="current-password" type={showCurrent ? 'text' : 'password'} autocomplete="current-password" required bind:value={current} />
						<button type="button" class="btn ghost" aria-pressed={showCurrent} onclick={() => (showCurrent = !showCurrent)}><Icon name="eye" size={14} />{m.account_show()}</button>
					</span>
					<label class="field" for="new-password">{m.account_new_password()}</label>
					<span class="with-show">
						<input id="new-password" type={showNew ? 'text' : 'password'} autocomplete="new-password" required bind:value={password} />
						<button type="button" class="btn ghost" aria-pressed={showNew} onclick={() => (showNew = !showNew)}><Icon name="eye" size={14} />{m.account_show()}</button>
					</span>
					<p class="count" class:enough={count >= MIN}>{m.account_password_count({ count, min: MIN })}</p>
					<p class="hint">{m.account_password_signs_out()}</p>
					{#if passwordResult === 'ok'}
						<p class="ok" role="status">{m.account_password_saved()}</p>
					{:else if passwordResult}
						<p class="error" {@attach revealAlert()}>{problemText(passwordResult)}</p>
					{/if}
					<button type="submit" class="btn" disabled={busy}>{m.account_change_password()}</button>
				</form>
			</section>

			<button type="button" class="btn wide" onclick={logout}>{m.account_log_out_device()}</button>
		</div>
	{/if}
</AccountCard>
{#if unsentAtLogout}
	<UnsentLogout flows={unsentAtLogout} onstay={() => (unsentAtLogout = null)} ondiscard={() => signOut(true)} />
{/if}

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
