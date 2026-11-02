<script lang="ts">
	// 隊員名單：加隊員、改隊員、刪隊員。名單順序 = 泳道順序。規則（40 人上限、必填）都交給流程核心判斷。
	// 刪隊員先顯示流程核心給的「要確認」說明，按確定才刪。
	import ConfirmList from './ConfirmList.svelte';
	import {
		MAX_MEMBERS,
		addMembers,
		deleteMember,
		updateMember,
		type CommandResult,
		type Flow,
		type Gender,
		type GlobalRole,
		type MemberChanges
	} from '#lib/core';

	let { flow, onchange }: { flow: Flow; onchange: (flow: Flow) => void } = $props();

	const GENDERS: [Gender, string][] = [
		['F', '女'],
		['M', '男']
	];
	const ROLES: [GlobalRole, string][] = [
		['base', '底層'],
		['top', '上層']
	];

	let names = $state('');
	let gender = $state<Gender | ''>('');
	let globalRole = $state<GlobalRole | ''>('');
	let error = $state('');

	function apply(r: CommandResult): boolean {
		if (r.kind === 'ok') {
			error = '';
			onchange(r.flow);
			return true;
		}
		error = r.message;
		return false;
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		const list = names.split('\n').filter((n) => n.trim());
		const inputs = (list.length ? list : ['']).map((name) => ({
			name,
			gender: gender || null,
			globalRole: globalRole || null
		}));
		if (apply(addMembers(flow, inputs))) names = '';
	}

	function edit(id: string, changes: MemberChanges, input?: HTMLInputElement) {
		const done = apply(updateMember(flow, id, changes));
		// 被擋下時把輸入框還原成原本的名字。
		if (!done && input) input.value = flow.members.find((m) => m.id === id)?.name ?? '';
	}

	/** 等教練確認要刪的隊員和流程核心給的說明。 */
	let pending = $state<{ id: string; message: string; items: string[] } | null>(null);

	function remove(id: string) {
		const r = deleteMember(flow, id);
		if (r.kind === 'confirm') pending = { id, message: r.message, items: r.items };
		else apply(r);
	}

	function confirmRemove() {
		if (!pending) return;
		apply(deleteMember(flow, pending.id, { confirmed: true }));
		pending = null;
	}
</script>

<section class="members">
	<h3>隊員（{flow.members.length} / {MAX_MEMBERS}）</h3>

	<ol>
		{#each flow.members as m, i (m.id)}
			<li>
				<span class="no">{i + 1}</span>
				<input
					aria-label="第 {i + 1} 位隊員的名字"
					value={m.name}
					onchange={(e) => edit(m.id, { name: e.currentTarget.value }, e.currentTarget)}
				/>
				<select
					aria-label="第 {i + 1} 位隊員的性別"
					value={m.gender}
					onchange={(e) => edit(m.id, { gender: e.currentTarget.value as Gender })}
				>
					{#each GENDERS as [v, label] (v)}<option value={v}>{label}</option>{/each}
				</select>
				<select
					aria-label="第 {i + 1} 位隊員的全局角色"
					value={m.globalRole}
					onchange={(e) => edit(m.id, { globalRole: e.currentTarget.value as GlobalRole })}
				>
					{#each ROLES as [v, label] (v)}<option value={v}>{label}</option>{/each}
				</select>
				<button type="button" class="remove" aria-label="刪除第 {i + 1} 位隊員" onclick={() => remove(m.id)}
					>✕</button
				>
			</li>
		{/each}
	</ol>

	{#if pending}
		<ConfirmList
			message={pending.message}
			items={pending.items}
			onconfirm={confirmRemove}
			oncancel={() => (pending = null)}
		/>
	{/if}

	<!-- novalidate：必填和人數上限由流程核心判斷 -->
	<form class="add" novalidate onsubmit={add}>
		<label class="names">
			名字（一次加多人：一行一個）
			<textarea rows="2" bind:value={names} placeholder="暱稱或背號"></textarea>
		</label>
		<label>
			性別
			<select bind:value={gender}>
				<option value="">請選</option>
				{#each GENDERS as [v, label] (v)}<option value={v}>{label}</option>{/each}
			</select>
		</label>
		<label>
			全局角色
			<select bind:value={globalRole}>
				<option value="">請選</option>
				{#each ROLES as [v, label] (v)}<option value={v}>{label}</option>{/each}
			</select>
		</label>
		<button type="submit">加隊員</button>
	</form>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.members {
		display: grid;
		gap: 8px;
		font-size: 13px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		max-height: 40vh;
		overflow-y: auto;
	}
	li {
		display: grid;
		grid-template-columns: 2em minmax(0, 1fr) auto auto auto;
		gap: 4px;
		align-items: center;
	}
	.no {
		color: #6b7280;
		text-align: right;
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: end;
		padding-top: 6px;
		border-top: 1px solid #dde1ea;
	}
	.add label {
		display: grid;
		gap: 2px;
	}
	.names {
		flex: 1 1 100%;
	}
	.error {
		margin: 0;
		color: #c0392b;
	}
</style>
