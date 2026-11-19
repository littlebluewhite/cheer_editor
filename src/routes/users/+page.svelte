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

	interface Props {
		/** 連伺服器；測試放假的（#lib/test-fakes.js 的 fakeServer）。 */
		server?: ServerAdapter;
	}
	let { server = httpServer() }: Props = $props();

	const QUOTA = '今天寄不出去，明天再試。';
	const UNREACHABLE = '連不上伺服器，請稍後再試。';

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
			failed = UNREACHABLE;
		}
	}

	function statusText(s: UserStatus): string {
		switch (s.kind) {
			case 'active':
				return '可以登入';
			case 'invited':
				return `等他設密碼（邀請信 ${s.hoursLeft} 小時後過期）`;
			case 'inviteExpired':
				return '邀請過期，他還沒設密碼';
			case 'disabled':
				return s.flows ? `已停用・他有 ${s.flows} 支流程` : '已停用';
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
			return UNREACHABLE;
		} finally {
			busy = false;
		}
	}

	function problemText(p: AdminProblem, problems: { emailTaken?: string } = {}): string {
		switch (p.kind) {
			case 'mailQuota':
				return QUOTA;
			case 'emailTaken':
				return problems.emailTaken ?? '這個 email 已經有帳號了。';
			case 'noAccount':
				return '這個 email 沒有帳號。';
			case 'sameUser':
				return '不能交給他自己。';
			case 'disabled':
				return `${p.name}被停用了，不能移交給他。`;
			case 'notAllowed':
				return '這個人現在不能這樣做，請重新整理再看看。';
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
			message = `寄了邀請給 ${to}。`;
		} else if (d.kind === 'email') {
			const to = email.trim();
			problem = await run(() => server.changeEmail(d.user.id, to), { emailTaken: '這個 email 已經是別人的了。' });
			message = `改好了：${d.user.name}的 email 是 ${to}，新舊兩個信箱都寄了通知。`;
		} else if (d.kind === 'handOver') {
			const to = email.trim();
			problem = await run(async () => {
				const r = await server.adminHandOver(d.user.id, to);
				return 'flows' in r ? 'ok' : r;
			});
			message = `移交了${d.user.name}的 ${d.flows} 支流程給 ${to}。`;
		} else {
			problem = await run(() => server.disableUser(d.user.id));
			message = `停用了${d.user.name}。`;
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

<svelte:head><title>管理使用者 — 流程編輯器</title></svelte:head>

<AccountCard wide>
	{#if users === null}
		<h1>管理使用者</h1>
		<p class="lead">只有管理員能看這一頁。</p>
	{:else}
		<header class="head">
			<h1>管理使用者</h1>
			{#if users}<button type="button" class="btn primary" onclick={() => open({ kind: 'add' })}>＋ 加使用者</button>{/if}
		</header>
		{#if done}<p class="ok" role="status">{done}</p>{/if}
		{#if failed}<p class="error" {@attach revealAlert()}>{failed}</p>{/if}
		{#if users}
			<div class="scroll">
				<table>
					<thead>
						<tr><th>名字</th><th>Email</th><th>狀態</th><th><span class="sr-only">按鈕</span></th></tr>
					</thead>
					<tbody>
						{#each users as u (u.id)}
							<tr>
								<td>{u.name}</td>
								<td class="email">{u.email}</td>
								<td class:off={u.status.kind !== 'active'}>{statusText(u.status)}</td>
								<td class="actions">
									{#if u.status.kind === 'active'}
										<button type="button" disabled={busy} onclick={() => now(() => server.sendReset(u.id), `寄了重設密碼信給 ${u.email}。`)}
											>寄重設密碼信</button
										>
									{:else if u.status.kind === 'disabled'}
										{@const flows = u.status.flows}
										<button type="button" disabled={busy} onclick={() => now(() => server.enableUser(u.id), `恢復了${u.name}，他用原本的密碼就能登入。`)}
											>恢復</button
										>
										{#if flows}
											<button type="button" onclick={() => open({ kind: 'handOver', user: u, flows })}>移交 {flows} 支流程</button>
										{/if}
									{:else}
										<button
											type="button"
											disabled={busy}
											onclick={() => now(() => server.resendInvite(u.id), `重寄了邀請給 ${u.email}，舊的連結不能用了。`)}>重寄邀請</button
										>
									{/if}
									<button type="button" onclick={() => open({ kind: 'email', user: u })}>改 email</button>
									{#if u.status.kind !== 'disabled' && !u.me}
										<button type="button" class="danger" onclick={() => open({ kind: 'disable', user: u })}>停用</button>
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
			? '加使用者'
			: d.kind === 'email'
				? `改 email：${d.user.name}`
				: d.kind === 'handOver'
					? `移交${d.user.name}的流程`
					: `停用${d.user.name}？`}
	<Modal label={title} class="dialog admin-dialog" onclose={() => (dialog = null)}>
		{#snippet children(close)}
			<header class="dialog-head">
				<h2>{title}</h2>
				<button type="button" class="ghost icon close" aria-label="關閉" onclick={close}><Icon name="close" /></button>
			</header>
			<form onsubmit={submit}>
				{#if d.kind === 'add'}
					<label class="field"><span>Email</span><input type="email" required data-autofocus bind:value={email} /></label>
					<label class="field"><span>名字</span><input required bind:value={name} /></label>
					<p class="hint">會寄一封邀請信給他，24 小時內設好密碼就能登入。名字他之後可以自己改。</p>
				{:else if d.kind === 'email'}
					<p>現在：{d.user.email}</p>
					<label class="field"><span>新的 email</span><input type="email" required data-autofocus bind:value={email} /></label>
					<p class="hint">改好後新舊兩個信箱都會收到通知，他下次用新的 email 登入。不能跟別人重複。</p>
				{:else if d.kind === 'handOver'}
					<label class="field"
						><span>{d.user.name}有 {d.flows} 支流程。全部交給：</span><input
							type="email"
							required
							placeholder="接手的人的 email"
							data-autofocus
							bind:value={email}
						/></label
					>
					<p class="hint">接手的人變成擁有者，{d.user.name}變成這些流程的編輯者。你看不到是哪幾支流程。</p>
				{:else}
					<ul>
						<li>他每台裝置馬上登出，還沒用的連結都不能用。</li>
						<li>他的流程、權限、記的紀錄都留著，別人照常能用。</li>
						<li>之後可以恢復，他用原本的密碼登入。</li>
					</ul>
				{/if}
				{#if dialogError}<p class="error" {@attach revealAlert()}>{dialogError}</p>{/if}
				<div class="buttons">
					<button type="button" data-autofocus={d.kind === 'disable' || undefined} onclick={close}>取消</button>
					<button type="submit" class={d.kind === 'disable' ? 'danger' : 'primary'} disabled={busy}>
						{d.kind === 'add' ? '寄邀請' : d.kind === 'email' ? '改 email' : d.kind === 'handOver' ? `移交 ${d.flows} 支流程` : '停用'}
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
