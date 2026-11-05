<script lang="ts">
	// 名詞對照表：固定和自訂任務角色的名稱、意思、規則上的叫法；也在這裡加、改、刪自訂角色。
	// 刪有人用的自訂角色時，核心回「要確認」：列出動作，按確定才刪。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		addCustomRole,
		deleteCustomRole,
		roleGlossary,
		updateCustomRole,
		type ConfirmOption,
		type CustomRole
	} from '#lib/core';
	import CharCount from './CharCount.svelte';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		onclose: () => void;
		/** 新增了自訂任務角色（新角色的名稱）。 */
		onadded?: (name: string) => void;
	}

	let { onclose, onadded }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	let name = $state('');
	let nameInput = $state<HTMLInputElement>();
	/** 每個自訂角色的名稱欄（旁邊的字數要看它），照角色 id。 */
	const roleInputs = $state<Record<string, HTMLInputElement>>({});
	let meaning = $state('');
	/** 被擋的原因，和刪有人用的角色時等教練確認的清單。 */
	const ask = session.changeAsk({ confirmLabel: '確定刪除' });

	/** 改自訂角色的名稱或意思；被擋就把輸入框還原。 */
	function edit(role: CustomRole, patch: Partial<Pick<CustomRole, 'name' | 'meaning'>>, input: HTMLInputElement) {
		const r = ask.send(() => updateCustomRole(flow, role.id, { name: role.name, meaning: role.meaning, ...patch }));
		if (r.kind !== 'ok') input.value = patch.name !== undefined ? role.name : role.meaning;
	}

	function remove(role: CustomRole) {
		ask.send((o: ConfirmOption = {}) => deleteCustomRole(flow, role.id, o));
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		ask.send(() => addCustomRole(flow, { name, meaning }), {
			done: () => {
				onadded?.(flow.customRoles.at(-1)!.name);
				name = '';
				meaning = '';
			}
		});
	}
</script>

<Modal label="名詞對照表" class="dialog glossary" {ask} {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>名詞對照表：任務角色</h2>
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={close}><Icon name="close" /></button>
		</header>
		<table>
			<thead>
				<tr><th>名稱</th><th>意思</th><th>規則上的叫法</th></tr>
			</thead>
			<tbody>
				<!-- 自訂角色用 id 當 key：改名時同一列不重畫，游標留在原地 -->
				{#each roleGlossary(flow) as r ((r.custom && flow.customRoles.find((c) => c.name === r.name)?.id) || r.name)}
					{@const custom = r.custom ? flow.customRoles.find((c) => c.name === r.name) : undefined}
					<tr>
						{#if custom}
							<td>
								<input
									class="role-name"
									aria-label="「{custom.name}」的名稱"
									value={custom.name}
									bind:this={roleInputs[custom.id]}
									onchange={(e) => edit(custom, { name: e.currentTarget.value }, e.currentTarget)}
								/><CharCount field="roleName" input={roleInputs[custom.id]} value={custom.name} quiet /><small
									class="tag">自訂</small
								>
							</td>
							<td>
								<input
									aria-label="「{custom.name}」的意思"
									value={custom.meaning}
									onchange={(e) => edit(custom, { meaning: e.currentTarget.value }, e.currentTarget)}
								/>
							</td>
							<td>
								<button
									type="button"
									class="ghost icon"
									aria-label="刪除任務角色「{custom.name}」"
									onclick={() => remove(custom)}><Icon name="trash" size={14} /></button
								>
							</td>
						{:else}
							<td><b>{r.name}</b>{#if r.custom}<small class="tag">自訂</small>{/if}</td>
							<td>{r.meaning}</td>
							<td>{r.ruleName || '—'}</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
		{#if ask.question}<ConfirmList {ask} />{/if}
		<!-- novalidate：名稱必填、不能重複由流程核心判斷 -->
		<form novalidate onsubmit={add}>
			<b>新增自訂任務角色</b>
			<div class="fields">
				<label
					>任務角色名稱 <input aria-label="任務角色名稱" bind:value={name} bind:this={nameInput} /><CharCount
						field="roleName"
						input={nameInput}
						value={name}
					/></label
				>
				<label>意思 <input bind:value={meaning} /></label>
				<button type="submit" class="primary">新增任務角色</button>
			</div>
			<p class="muted">自訂任務角色只存在這一支流程裡。在上面的表裡可以直接改名稱、意思，或按垃圾桶刪掉。</p>
		</form>
		{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
	{/snippet}
</Modal>

<style>
	:global(.glossary) {
		width: min(760px, 100%);
		font-size: 13px;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		border-bottom: 1px solid var(--line-soft, #e8ecf3);
		padding: 7px 8px;
		text-align: left;
		vertical-align: top;
	}
	th {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
		border-bottom-color: var(--line, #d8dee9);
	}
	td:first-child {
		white-space: nowrap;
	}
	.role-name {
		width: 9em;
		font-weight: 600;
	}
	td :global(.char-count) {
		margin-left: 4px;
	}
	.tag {
		margin-left: 6px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--mat-soft, #e3ecf9);
		color: var(--mat, #2f66b8);
		font-size: 11px;
	}
	form {
		display: grid;
		gap: 8px;
		padding: 12px 14px;
		border-radius: 10px;
		background: var(--surface-2, #f6f8fb);
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.fields label {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.muted {
		color: var(--muted, #66718a);
		font-size: 12px;
	}
	p {
		margin: 0;
	}
	.error {
		color: var(--danger, #c8372d);
	}
</style>
