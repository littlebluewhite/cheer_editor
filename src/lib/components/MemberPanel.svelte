<script lang="ts">
	// 隊員名單：加隊員、改隊員、刪隊員。名單順序 = 泳道順序。規則（40 人上限、必填）都交給流程核心判斷。
	// 刪隊員先顯示流程核心給的「要確認」說明，按確定才刪。
	// 改名字而他有紀錄時，核心回「要選」：保留舊紀錄（改錯字）、清掉重算（換人了）、取消（名字還原）。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import { Ask } from './ask.svelte';
	import { isLongMarker } from './marker';
	import { reveal } from './reveal';
	import {
		GENDERS,
		GLOBAL_ROLES,
		MAX_MEMBERS,
		addMembers,
		deleteMember,
		memberMarkers,
		memberName,
		updateMember,
		type ConfirmOption,
		type Gender,
		type GlobalRole,
		type MemberChanges
	} from '#lib/core';

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	let names = $state('');
	let gender = $state<Gender | ''>('');
	let globalRole = $state<GlobalRole | ''>('');
	/**
	 * 等教練回答的事和流程核心給的說明：刪隊員（確定刪除），或改了有紀錄的人的名字（保留舊紀錄／清掉重算）。
	 */
	const ask = new Ask((f) => session.change(f), { confirmLabel: '確定刪除' });
	const markers = $derived(memberMarkers(flow));

	function add(e: SubmitEvent) {
		e.preventDefault();
		const list = names.split('\n').filter((n) => n.trim());
		const inputs = (list.length ? list : ['']).map((name) => ({
			name,
			gender: gender || null,
			globalRole: globalRole || null
		}));
		ask.send(() => addMembers(flow, inputs), { done: () => (names = '') });
	}

	function edit(id: string, changes: MemberChanges, input?: HTMLInputElement) {
		const r = ask.send((o: ConfirmOption = {}) => updateMember(flow, id, changes, o));
		// 被擋下（或要問）時把輸入框還原成原本的名字；選好了核心改的名字會再畫上去。
		if (r.kind !== 'ok' && input) input.value = memberName(flow, id);
	}

	function remove(id: string) {
		ask.send((o: ConfirmOption = {}) => deleteMember(flow, id, o));
	}
</script>

<section class="members">
	<header>
		<h3>隊員（{flow.members.length} / {MAX_MEMBERS}）</h3>
		<span class="hint">名單順序就是泳道順序和場上的號碼；在「流程設定」可以把號碼換成開頭字（名字的第一個字）</span>
	</header>

	{#if flow.members.length}
		<ol>
			{#each flow.members as m, i (m.id)}
				<li>
					<span class="no {m.globalRole}" class:long={isLongMarker(markers[m.id])}>{markers[m.id]}</span>
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
						{#each GENDERS as g (g.key)}<option value={g.key}>{g.label}</option>{/each}
					</select>
					<select
						aria-label="第 {i + 1} 位隊員的全局角色"
						value={m.globalRole}
						onchange={(e) => edit(m.id, { globalRole: e.currentTarget.value as GlobalRole })}
					>
						{#each GLOBAL_ROLES as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
					</select>
					<button
						type="button"
						class="ghost icon remove"
						aria-label="刪除第 {i + 1} 位隊員"
						onclick={() => remove(m.id)}><Icon name="trash" size={14} /></button
					>
				</li>
			{/each}
		</ol>
	{/if}

	<!-- 名單很長時問句和原因在看得到的範圍下面，按了像沒反應：出現時捲過去。 -->
	{#if ask.question}
		<div {@attach reveal(ask.failures)}><ConfirmList {ask} /></div>
	{/if}

	<!-- novalidate：必填和人數上限由流程核心判斷 -->
	<form class="add" novalidate onsubmit={add}>
		<b class="add-title">加隊員</b>
		<label class="names">
			名字（一次加多人：一行一個）
			<textarea rows="3" bind:value={names} placeholder="名字或暱稱"></textarea>
		</label>
		<div class="pair">
			<label>
				性別
				<select bind:value={gender}>
					<option value="">請選</option>
					{#each GENDERS as g (g.key)}<option value={g.key}>{g.label}</option>{/each}
				</select>
			</label>
			<label>
				全局角色
				<select bind:value={globalRole}>
					<option value="">請選</option>
					{#each GLOBAL_ROLES as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
				</select>
			</label>
		</div>
		<button type="submit" class="primary">加隊員</button>
	</form>

	{#if ask.error}<p class="error" role="alert" {@attach reveal(ask.failures)}>{ask.error}</p>{/if}
</section>

<style>
	.members {
		display: grid;
		gap: 12px;
		font-size: 13px;
	}
	header {
		display: grid;
		gap: 2px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	.hint {
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	li {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr) 58px 72px 28px;
		gap: 6px;
		align-items: center;
	}
	.no {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		border: 1.5px solid #16213a;
		background: #fff;
	}
	.no.long {
		font-size: 8px;
		letter-spacing: -0.3px;
	}
	.no.top {
		background: var(--top, #e0664f);
		color: #fff;
	}
	li input,
	li select {
		width: 100%;
	}
	.remove {
		color: var(--muted, #66718a);
	}
	.remove:hover {
		color: var(--danger, #c8372d);
	}
	.add {
		display: grid;
		gap: 10px;
		padding: 14px;
		border-radius: 12px;
		background: var(--surface-2, #f6f8fb);
		border: 1px solid var(--line-soft, #e8ecf3);
	}
	.add-title {
		font-size: 13px;
	}
	.add label {
		display: grid;
		gap: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	.add textarea,
	.add select {
		width: 100%;
		font-weight: 400;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.add button {
		width: 100%;
		padding: 7px 12px;
	}
	.error {
		margin: 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
