<script lang="ts">
	// 管理使用者（#245，#190 的 A）：只有管理員看得到，一頁一張表。字照 #190 的結論留言。
	// 寄重設密碼信、重寄邀請、恢復：按了直接做，表上面綠色一行說做了什麼。加使用者、改 email、停用：跳對話框。
	// 只有停用，沒有刪除使用者。被停用又有流程的寫「已停用・他有 N 支流程」，多［移交 N 支流程］（#252）：
	// 對話框輸入接手的人的 email，全部交給同一個人；管理員只看到支數，看不到流程名字。
	import { onMount } from 'svelte';
	import AccountCard from '#lib/components/AccountCard.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import {
		httpServer,
		type AdminProblem,
		type AdminResult,
		type ServerAdapter,
		type UserRow,
		type UserStatus
	} from '#lib/server-api.js';
	import { revealAlert } from '#lib/components/reveal.js';
	import { m } from '#lib/paraglide/messages.js';

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
	}
	let { server = httpServer() }: Props = $props();


	/** 名單：還在問是 undefined，不是管理員是 null。 */
	let users = $state.raw<UserRow[] | null | undefined>(undefined);
	/** 表上面綠色那一行（做好了）、紅色那一行（沒做成）。 */
	let done = $state('');
	let failed = $state('');
	let busy = $state(false);

	type Dialog =
		| { kind: 'add' }
		| { kind: 'email'; user: UserRow }
		| { kind: 'disable'; user: UserRow }
		| { kind: 'handOver'; user: UserRow; flows: number };
	let dialog = $state.raw<Dialog | null>(null);
	let dialogError = $state('');
	let email = $state('');
	let name = $state('');

	onMount(load);

	async function load() {
		try {
			users = await server.listUsers();
		} catch {
			failed = m.server_unreachable();
		}
	}

	function statusText(s: UserStatus): string {
		switch (s.kind) {
			case 'active':
				return m.users_status_active();
			case 'invited':
				return (s.hoursLeft === 1 ? m.users_status_invited_one : m.users_status_invited)({ hours: s.hoursLeft });
			case 'inviteExpired':
				return m.users_status_invite_expired();
			case 'disabled':
				if (!s.flows) return m.users_status_disabled();
				return (s.flows === 1 ? m.users_status_disabled_flows_one : m.users_status_disabled_flows)({ n: s.flows });
		}
	}

	/** 叫伺服器做一件事，做好了重新拿名單；回做不成的原因（做好了是 null）。 */
	async function run(call: () => Promise<AdminResult>, problems: { emailTaken?: string } = {}): Promise<string | null> {
		busy = true;
		try {
			const result = await call();
			if (result === 'ok') {
				await load();
				return null;
			}
			return problemText(result, problems);
		} catch {
			return m.server_unreachable();
		} finally {
			busy = false;
		}
	}

	function problemText(p: AdminProblem, problems: { emailTaken?: string } = {}): string {
		switch (p.kind) {
			case 'mailQuota':
				return m.users_mail_quota();
			case 'emailTaken':
				return problems.emailTaken ?? m.users_email_has_account();
			case 'noAccount':
				return m.users_email_no_account();
			case 'sameUser':
				return m.users_same_user();
			case 'disabled':
				return m.users_hand_over_disabled({ name: p.name });
			case 'notAllowed':
				return m.users_not_allowed();
		}
	}

	/** 寄信、重寄、恢復：按了直接做。 */
	async function now(call: () => Promise<AdminResult>, message: string) {
		done = failed = '';
		const problem = await run(call);
		if (problem) failed = problem;
		else done = message;
	}

	function open(d: Dialog) {
		dialog = d;
		dialogError = '';
		email = '';
		name = '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!dialog) return;
		const d = dialog;
		let problem: string | null;
		let message: string;
		if (d.kind === 'add') {
			const [to, who] = [email.trim(), name.trim()];
			problem = await run(() => server.addUser(to, who));
			message = m.users_invite_sent({ email: to });
		} else if (d.kind === 'email') {
			const to = email.trim();
			problem = await run(() => server.changeEmail(d.user.id, to), { emailTaken: m.users_email_taken() });
			message = m.users_email_changed({ name: d.user.name, email: to });
		} else if (d.kind === 'handOver') {
			const to = email.trim();
			problem = await run(async () => {
				const r = await server.adminHandOver(d.user.id, to);
				return 'flows' in r ? 'ok' : r;
			});
			message = (d.flows === 1 ? m.users_handed_over_one : m.users_handed_over)({ name: d.user.name, n: d.flows, email: to });
		} else {
			problem = await run(() => server.disableUser(d.user.id));
			message = m.users_disabled_done({ name: d.user.name });
		}
		if (problem) {
			dialogError = problem;
			return;
		}
		dialog = null;
		failed = '';
		done = message;
	}
</script>

<svelte:head><title>{m.page_title({ page: m.users_title() })}</title></svelte:head>

<AccountCard wide>
	{#if users === null}
		<h1>{m.users_title()}</h1>
		<p class="lead">{m.users_admin_only()}</p>
	{:else}
		<header class="head">
			<h1>{m.users_title()}</h1>
			{#if users}<button type="button" class="btn primary" onclick={() => open({ kind: 'add' })}>{m.users_add_button()}</button>{/if}
		</header>
		{#if done}<p class="ok" role="status">{done}</p>{/if}
		{#if failed}<p class="error" {@attach revealAlert()}>{failed}</p>{/if}
		{#if users}
			<div class="scroll">
				<table>
					<thead>
						<tr><th>{m.account_name()}</th><th>Email</th><th>{m.users_status()}</th><th><span class="sr-only">{m.users_buttons()}</span></th></tr>
					</thead>
					<tbody>
						{#each users as u (u.id)}
							<tr>
								<td>{u.name}</td>
								<td class="email">{u.email}</td>
								<td class:off={u.status.kind !== 'active'}>{statusText(u.status)}</td>
								<td class="actions">
									{#if u.status.kind === 'active'}
										<button type="button" disabled={busy} onclick={() => now(() => server.sendReset(u.id), m.users_reset_sent({ email: u.email }))}
											>{m.users_send_reset()}</button
										>
									{:else if u.status.kind === 'disabled'}
										{@const flows = u.status.flows}
										<button type="button" disabled={busy} onclick={() => now(() => server.enableUser(u.id), m.users_enabled({ name: u.name }))}
											>{m.users_enable()}</button
										>
										{#if flows}
											<button type="button" onclick={() => open({ kind: 'handOver', user: u, flows })}>{(flows === 1 ? m.users_hand_over_button_one : m.users_hand_over_button)({ n: flows })}</button>
										{/if}
									{:else}
										<button
											type="button"
											disabled={busy}
											onclick={() => now(() => server.resendInvite(u.id), m.users_invite_resent({ email: u.email }))}>{m.users_resend_invite()}</button
										>
									{/if}
									<button type="button" onclick={() => open({ kind: 'email', user: u })}>{m.users_change_email()}</button>
									{#if u.status.kind !== 'disabled' && !u.me}
										<button type="button" class="danger" onclick={() => open({ kind: 'disable', user: u })}>{m.users_disable()}</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</AccountCard>

{#if dialog}
	{@const d = dialog}
	{@const title =
		d.kind === 'add'
			? m.users_add()
			: d.kind === 'email'
				? m.users_change_email_title({ name: d.user.name })
				: d.kind === 'handOver'
					? m.users_hand_over_title({ name: d.user.name })
					: m.users_disable_title({ name: d.user.name })}
	<Modal label={title} class="dialog admin-dialog" onclose={() => (dialog = null)}>
		{#snippet children(close)}
			<header class="dialog-head">
				<h2>{title}</h2>
				<button type="button" class="ghost icon close" aria-label={m.account_close()} onclick={close}><Icon name="close" /></button>
			</header>
			<form onsubmit={submit}>
				{#if d.kind === 'add'}
					<label class="field"><span>Email</span><input type="email" required data-autofocus bind:value={email} /></label>
					<label class="field"><span>{m.account_name()}</span><input required bind:value={name} /></label>
					<p class="hint">{m.users_add_hint()}</p>
				{:else if d.kind === 'email'}
					<p>{m.users_current_email({ email: d.user.email })}</p>
					<label class="field"><span>{m.users_new_email()}</span><input type="email" required data-autofocus bind:value={email} /></label>
					<p class="hint">{m.users_change_email_hint()}</p>
				{:else if d.kind === 'handOver'}
					<label class="field"
						><span>{(d.flows === 1 ? m.users_hand_over_to_one : m.users_hand_over_to)({ name: d.user.name, n: d.flows })}</span><input
							type="email"
							required
							placeholder={m.users_hand_over_placeholder()}
							data-autofocus
							bind:value={email}
						/></label
					>
					<p class="hint">{m.users_hand_over_hint({ name: d.user.name })}</p>
				{:else}
					<ul>
						<li>{m.users_disable_signs_out()}</li>
						<li>{m.users_disable_keeps()}</li>
						<li>{m.users_disable_undo()}</li>
					</ul>
				{/if}
				{#if dialogError}<p class="error" {@attach revealAlert()}>{dialogError}</p>{/if}
				<div class="buttons">
					<button type="button" data-autofocus={d.kind === 'disable' || undefined} onclick={close}>{m.account_cancel()}</button>
					<button type="submit" class={d.kind === 'disable' ? 'danger' : 'primary'} disabled={busy}>
						{d.kind === 'add'
							? m.users_send_invite()
							: d.kind === 'email'
								? m.users_change_email()
								: d.kind === 'handOver'
									? (d.flows === 1 ? m.users_hand_over_button_one : m.users_hand_over_button)({ n: d.flows })
									: m.users_disable()}
					</button>
				</div>
			</form>
		{/snippet}
	</Modal>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.ok,
	.error {
		margin-bottom: 12px;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	th,
	td {
		text-align: left;
		padding: 8px;
		border-bottom: 1px solid var(--line-soft);
		vertical-align: middle;
	}
	th {
		font-size: 12px;
		color: var(--muted);
		font-weight: 600;
	}
	.email {
		overflow-wrap: anywhere;
	}
	.off {
		color: var(--muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: flex-end;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	:global(.admin-dialog) {
		width: min(420px, 100%);
	}
	form {
		display: grid;
		gap: 10px;
	}
	.field {
		display: grid;
		gap: 4px;
		font-size: 13px;
		font-weight: 600;
	}
	.field input {
		font-weight: 400;
		font-size: 15px;
		padding: 8px 10px;
	}
	ul {
		margin: 0;
		padding-left: 20px;
		display: grid;
		gap: 4px;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
