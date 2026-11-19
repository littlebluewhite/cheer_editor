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

	interface Props {
		flowId: string;
		flowName: string;
		onclose: () => void;
	}

	let { flowId, flowName, onclose }: Props = $props();
	const editor = getEditor();
	const server = editor.adapters.server;
	const UNREACHABLE = '連不上伺服器，再試一次。';
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
			done = '複製了分享連結。';
		} catch {
			error = '複製不了，請自己選取連結複製。';
		}
	}

	function problemText(p: ShareProblem): string {
		switch (p.kind) {
			case 'noAccount':
				return '這個 email 還沒有帳號，請管理員先加。';
			case 'yourself':
				return '這是你自己。';
			case 'already':
				return `${p.name}已經是${ROLE_NAMES[p.role]}了，要改在下面改。`;
			case 'disabled':
				return `${p.name}的帳號被停用了，不能分享給他。`;
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
				done = `收回了${p.name}的權限。`;
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
				done = `移交了：${to.name}現在是擁有者，你是編輯者。`;
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
				message: `離開「${flowName}」？它不會再出現在「分享給我的」，要擁有者再分享給你才能打開。`,
				label: '離開',
				run: leave
			};
		}
		if (asking.kind === 'delete') {
			return { message: `刪掉「${flowName}」？所有人都打不開，成功率紀錄一起刪，不能復原。`, label: '刪掉', run: deleteFlow };
		}
		const { to } = asking;
		return {
			message: `把「${flowName}」移交給${to.name}？交出去後${to.name}是擁有者，你變成編輯者，不能再分享、改別人的權限、刪這支流程。${to.name}不用接受，馬上生效。`,
			label: '移交',
			run: () => handOver(to)
		};
	});
</script>

<Modal label={`分享「${flowName}」`} class="dialog share-dialog" {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>分享「{flowName}」</h2>
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={close}><Icon name="close" /></button>
		</header>
		{#if amOwner}
			<form class="add" onsubmit={add}>
				<input type="email" aria-label="Email" placeholder="對方登入用的 email" bind:value={email} />
				<select aria-label="權限" bind:value={role}>
					{#each GRANTS as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
				</select>
				<button type="submit" class="primary">加入</button>
			</form>
		{/if}
		{#if error}<p class="error" {@attach revealAlert()}>{error}</p>{/if}
		{#if done}<p class="done" role="status">{done}</p>{/if}
		<h3 id="share-people">有權限的人</h3>
		<ul class="people" aria-labelledby="share-people">
			{#each people ?? [] as p (p.userId)}
				<li>
					<span class="avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
					<span class="who">
						<span class="name"
							>{p.name}{p.me ? '（你）' : ''}{#if p.disabled}<span class="off">已停用</span>{/if}</span
						>
						{#if p.email}<small>{p.email}</small>{/if}
					</span>
					{#if p.role === 'owner' || !amOwner}
						<span class="role">{ROLE_NAMES[p.role]}</span>
					{:else}
						<select aria-label={`${p.name}的權限`} value={p.role} onchange={(e) => pick(p, e.currentTarget)}>
							{#each GRANTS as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
							<hr />
							<option value="owner" disabled={p.disabled}>設為擁有者（移交）</option>
							<option value="revoke">收回</option>
						</select>
					{/if}
				</li>
			{/each}
		</ul>
		{#if link !== undefined}
			<section class="link-part" role="group" aria-labelledby="share-link">
				<h3 id="share-link">分享連結</h3>
				{#if amOwner}
					<label class="switch"
						><input type="checkbox" role="switch" checked={link !== null} onchange={(e) => switchLink(e.currentTarget.checked)} />{link
							? '開著：拿到連結的人都能看'
							: '關著'}</label
					>
				{:else}
					<p>{link ? '開著' : '關著'}（只有擁有者能開、關）</p>
				{/if}
				{#if link}
					{@const url = shareUrl(link)}
					<div class="copy">
						<input aria-label="連結" readonly value={url} onfocus={(e) => e.currentTarget.select()} />
						<button type="button" onclick={() => copy(url)}>複製</button>
					</div>
				{/if}
				{#if amOwner}
					<small>不用登入就能看編排（場地、八拍表、播放），看不到練習頁和成功率。關掉再打開會換一條新的，舊的就不能用。</small>
				{/if}
			</section>
		{/if}
		{#if confirm}
			<ConfirmList message={confirm.message} items={[]} confirmLabel={confirm.label} onconfirm={confirm.run} oncancel={() => (asking = null)} focusCancel />
		{:else}
			<footer>
				{#if amOwner}
					<button type="button" class="ghost danger" onclick={() => (asking = { kind: 'delete' })}>刪掉這支流程</button>
				{:else if people}
					<button type="button" class="ghost" onclick={() => (asking = { kind: 'leave' })}>離開這支流程</button>
				{/if}
				<button type="button" class="primary done-btn" onclick={close}>完成</button>
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
