<script lang="ts">
	// 分享對話框（#250，照〈登入、設密碼、分享對話框長什麼樣〉的 A）：每個人都叫「分享」。
	// 擁有者：最上面 email、權限（預設編輯者）、「加入」（Enter 也算）；每個人右邊一個選單改權限、「收回」（不用確認）。
	// 不是擁有者：只看得到名字、權限（沒有 email），最下面「離開這支流程」（要確認）。右下「完成」。
	// 「分享連結」一段（#251）：擁有者有開關，開著時連結加「複製」；不是擁有者看得到開著沒、開著時也能複製。
	// 移交（#252）：選單裡「設為擁有者（移交）」（被停用的人選不到），要確認；擁有者最下面「刪掉這支流程」，問一次。
	import { onMount } from 'svelte';
	import { getEditor } from '#lib/editor.svelte.js';
	import { ROLE_NAMES } from '#lib/role-names.js';
	import { shareUrl } from '#lib/share-link.js';
	import type { Person, Role, ShareProblem } from '#lib/server-api.js';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { revealAlert } from './reveal';
	import { m } from '#lib/paraglide/messages.js';

	interface Props {
		flowId: string;
		flowName: string;
		onclose: () => void;
	}

	let { flowId, flowName, onclose }: Props = $props();
	const editor = getEditor();
	const server = editor.adapters.server;
	const UNREACHABLE = m.share_unreachable();
	/** 能分享出去的權限（擁有者不在這裡選：選單另外有「設為擁有者（移交）」）。 */
	const GRANTS = ['editor', 'recorder', 'viewer'] as const;

	/** 有權限的人；還沒拿到是 null。 */
	let people = $state.raw<Person[] | null>(null);
	let email = $state('');
	let role = $state<Exclude<Role, 'owner'>>('editor');
	/** 加不進去、連不上的原因（紅字）。 */
	let error = $state('');
	/** 做好了什麼（綠字，例：收回了王教練的權限。）。 */
	let done = $state('');
	/** 分享連結：開著是連結的那串字，關著 null；還沒拿到是 undefined。 */
	let link = $state<string | null | undefined>(undefined);
	/** 在問的事：離開、刪掉這支流程、移交給誰。 */
	let asking = $state.raw<{ kind: 'leave' } | { kind: 'delete' } | { kind: 'handOver'; to: Person } | null>(null);

	const amOwner = $derived(people?.some((p) => p.me && p.role === 'owner') ?? false);

	onMount(() => {
		server.people(flowId).then(
			(list) => (people = list ?? []),
			() => (error = UNREACHABLE)
		);
		server.shareLink(flowId).then(
			(token) => (link = token),
			() => (error = UNREACHABLE)
		);
	});

	/** 擁有者開、關分享連結（關掉再打開，伺服器換一條新的）。 */
	async function switchLink(on: boolean) {
		error = '';
		done = '';
		try {
			link = await server.switchShareLink(flowId, on);
		} catch {
			error = UNREACHABLE;
		}
	}

	async function copy(url: string) {
		error = '';
		done = '';
		try {
			await navigator.clipboard.writeText(url);
			done = m.share_copied();
		} catch {
			error = m.share_copy_failed();
		}
	}

	function problemText(p: ShareProblem): string {
		switch (p.kind) {
			case 'noAccount':
				return m.share_no_account();
			case 'yourself':
				return m.share_yourself();
			case 'already':
				return m.share_already({ name: p.name, role: ROLE_NAMES[p.role] });
			case 'disabled':
				return m.share_disabled({ name: p.name });
		}
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (!email.trim()) return;
		error = '';
		done = '';
		try {
			const r = await server.share(flowId, email.trim(), role);
			if (Array.isArray(r)) {
				people = r;
				email = '';
			} else error = problemText(r);
		} catch {
			error = UNREACHABLE;
		}
	}

	/** 每列右邊的選單：換權限，或收回（不用確認，收錯了再加回來）；移交要先確認。 */
	async function pick(p: Person, menu: HTMLSelectElement) {
		const value = menu.value;
		error = '';
		done = '';
		if (value === 'owner') {
			menu.value = p.role;
			asking = { kind: 'handOver', to: p };
			return;
		}
		try {
			if (value === 'revoke') {
				people = await server.revoke(flowId, p.userId);
				done = m.share_revoked({ name: p.name });
			} else {
				people = await server.setRole(flowId, p.userId, value as Role);
			}
		} catch {
			error = UNREACHABLE;
		}
	}

	async function leave() {
		try {
			await editor.file.leaveCloud();
		} catch {
			asking = null;
			error = UNREACHABLE;
		}
	}

	async function deleteFlow() {
		try {
			await editor.file.deleteCloud();
		} catch {
			asking = null;
			error = UNREACHABLE;
		}
	}

	/** 移交（確認過了）：對方是擁有者，我變編輯者。 */
	async function handOver(to: Person) {
		asking = null;
		try {
			const r = await server.handOver(flowId, to.userId);
			if (Array.isArray(r)) {
				people = r;
				done = m.share_handed_over({ name: to.name });
			} else error = problemText(r);
		} catch {
			error = UNREACHABLE;
		}
	}

	/** 確認框的字、確定鈕、按了做什麼。 */
	const confirm = $derived.by(() => {
		if (!asking) return null;
		if (asking.kind === 'leave') {
			return {
				message: m.share_leave_confirm({ flow: flowName }),
				label: m.share_leave(),
				run: leave
			};
		}
		if (asking.kind === 'delete') {
			return { message: m.share_delete_confirm({ flow: flowName }), label: m.share_delete(), run: deleteFlow };
		}
		const { to } = asking;
		return {
			message: m.share_hand_over_confirm({ flow: flowName, name: to.name }),
			label: m.share_hand_over(),
			run: () => handOver(to)
		};
	});
</script>

<Modal label={m.share_title({ flow: flowName })} class="dialog share-dialog" {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>{m.share_title({ flow: flowName })}</h2>
			<button type="button" class="ghost icon close" aria-label={m.account_close()} onclick={close}><Icon name="close" /></button>
		</header>
		{#if amOwner}
			<form class="add" onsubmit={add}>
				<input type="email" aria-label="Email" placeholder={m.share_email_placeholder()} bind:value={email} />
				<select aria-label={m.share_permission()} bind:value={role}>
					{#each GRANTS as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
				</select>
				<button type="submit" class="primary">{m.share_add()}</button>
			</form>
		{/if}
		{#if error}<p class="error" {@attach revealAlert()}>{error}</p>{/if}
		{#if done}<p class="done" role="status">{done}</p>{/if}
		<h3 id="share-people">{m.share_people()}</h3>
		<ul class="people" aria-labelledby="share-people">
			{#each people ?? [] as p (p.userId)}
				<li>
					<span class="avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
					<span class="who">
						<span class="name"
							>{p.me ? m.share_name_you({ name: p.name }) : p.name}{#if p.disabled}<span class="off">{m.users_status_disabled()}</span>{/if}</span
						>
						{#if p.email}<small>{p.email}</small>{/if}
					</span>
					{#if p.role === 'owner' || !amOwner}
						<span class="role">{ROLE_NAMES[p.role]}</span>
					{:else}
						<select aria-label={m.share_person_permission({ name: p.name })} value={p.role} onchange={(e) => pick(p, e.currentTarget)}>
							{#each GRANTS as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
							<hr />
							<option value="owner" disabled={p.disabled}>{m.share_make_owner()}</option>
							<option value="revoke">{m.share_revoke()}</option>
						</select>
					{/if}
				</li>
			{/each}
		</ul>
		{#if link !== undefined}
			<section class="link-part" role="group" aria-labelledby="share-link">
				<h3 id="share-link">{m.share_link()}</h3>
				{#if amOwner}
					<label class="switch"
						><input type="checkbox" role="switch" checked={link !== null} onchange={(e) => switchLink(e.currentTarget.checked)} />{link
							? m.share_link_on_owner()
							: m.share_link_off()}</label
					>
				{:else}
					<p>{link ? m.share_link_on_others() : m.share_link_off_others()}</p>
				{/if}
				{#if link}
					{@const url = shareUrl(link)}
					<div class="copy">
						<input aria-label={m.share_link_label()} readonly value={url} onfocus={(e) => e.currentTarget.select()} />
						<button type="button" onclick={() => copy(url)}>{m.share_copy()}</button>
					</div>
				{/if}
				{#if amOwner}
					<small>{m.share_link_hint()}</small>
				{/if}
			</section>
		{/if}
		{#if confirm}
			<ConfirmList message={confirm.message} items={[]} confirmLabel={confirm.label} onconfirm={confirm.run} oncancel={() => (asking = null)} focusCancel />
		{:else}
			<footer>
				{#if amOwner}
					<button type="button" class="ghost danger" onclick={() => (asking = { kind: 'delete' })}>{m.share_delete_flow()}</button>
				{:else if people}
					<button type="button" class="ghost" onclick={() => (asking = { kind: 'leave' })}>{m.share_leave_flow()}</button>
				{/if}
				<button type="button" class="primary done-btn" onclick={close}>{m.share_done()}</button>
			</footer>
		{/if}
	{/snippet}
</Modal>

<style>
	:global(.share-dialog) {
		width: min(480px, 100%);
		font-size: 13px;
	}
	.add {
		display: flex;
		gap: 8px;
	}
	.add input {
		flex: 1;
		min-width: 0;
	}
	h3 {
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.people {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.people li {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.avatar {
		flex: none;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--mat-soft);
		color: var(--mat);
		font-weight: 700;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: grid;
	}
	.who small {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.off {
		margin-left: 6px;
		color: var(--danger);
		font-size: 12px;
	}
	.role {
		color: var(--muted);
	}
	.done {
		color: var(--new-line);
	}
	.link-part {
		display: grid;
		gap: 6px;
	}
	.link-part p {
		margin: 0;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.copy {
		display: flex;
		gap: 8px;
	}
	.copy input {
		flex: 1;
		min-width: 0;
	}
	.link-part small {
		color: var(--muted);
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.done-btn {
		margin-left: auto;
	}
</style>
