<script lang="ts">
	// 流程設定：流程名字、場地（唯讀，建好之後不能換）、規則警告的開關和三個數字（可以恢復預設）、
	// 標記用號碼還是開頭字、自訂任務角色（新增、改名、刪除）。被擋就顯示流程核心給的原因。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		addCustomRole,
		DEFAULT_TIME_RULES,
		deleteCustomRole,
		memberMarkers,
		renameFlow,
		setMarkers,
		updateCustomRole,
		updateTimeRules,
		type ConfirmOption,
		type CustomRole,
		type MarkerStyle,
		type TimeRules
	} from '#lib/core';
	import CharCount from './CharCount.svelte';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { isLongMarker } from './marker';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 被擋的原因，和刪有人用的自訂任務角色時等教練確認的清單。 */
	const ask = session.changeAsk({ confirmLabel: '確定刪除' });
	let nameInput = $state<HTMLInputElement>();
	/** 新的自訂任務角色名稱。 */
	let roleName = $state('');
	let roleNameInput = $state<HTMLInputElement>();
	/** 每個自訂任務角色的名稱欄（旁邊的字數要看它），照角色 id。 */
	const roleInputs = $state<Record<string, HTMLInputElement>>({});
	const isDefault = $derived(
		(Object.keys(DEFAULT_TIME_RULES) as (keyof TimeRules)[]).every((k) => flow.timeRules[k] === DEFAULT_TIME_RULES[k])
	);

	/** 改自訂任務角色的名稱；被擋就把輸入框還原。 */
	function renameRole(role: CustomRole, input: HTMLInputElement) {
		ask.send(() => updateCustomRole(flow, role.id, { name: input.value, meaning: role.meaning }), {
			revert: () => (input.value = role.name)
		});
	}

	function addRole(e: SubmitEvent) {
		e.preventDefault();
		ask.send(() => addCustomRole(flow, { name: roleName, meaning: '' }), { done: () => (roleName = '') });
	}

	function update(patch: Partial<TimeRules>) {
		ask.send(() => updateTimeRules(flow, patch));
	}

	/** 改一個秒數；被擋就把那一格還原成實際的值，原因記在那一格。 */
	function setSeconds(key: (typeof fields)[number][0], label: string, input: HTMLInputElement) {
		ask.send(() => updateTimeRules(flow, { [key]: input.valueAsNumber }), {
			field: label,
			revert: () => (input.value = String(flow.timeRules[key]))
		});
	}

	function rename(input: HTMLInputElement) {
		// 被擋下時把輸入框還原成原本的名字。
		ask.send(() => renameFlow(flow, input.value), { field: '流程名字', revert: () => (input.value = flow.name) });
	}

	const markers = $derived(memberMarkers(flow));
	const MARKER_STYLES: { key: MarkerStyle; label: string }[] = [
		{ key: 'number', label: '號碼（名單第幾個）' },
		{ key: 'initial', label: '開頭字（名字的第一個字）' }
	];

	const fields = [
		['minChantSec', '口號段加起來最少（秒）'],
		['maxMusicSec', '音樂段加起來最多（秒）'],
		['maxTotalSec', '整支流程最多（秒）']
	] as const;
</script>

<Modal label="流程設定" class="dialog flow-dialog" {ask} {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>流程設定</h2>
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={close}><Icon name="close" /></button>
		</header>
		<label class="stack">
			<span class="head">流程名字<CharCount field="flowName" input={nameInput} value={flow.name} /></span>
			<input aria-label="流程名字" value={flow.name} bind:this={nameInput} onchange={(e) => rename(e.currentTarget)} />
		</label>
		<p class="field-info">
			<b>場地</b>
			<span>{flow.field.strips} 條{flow.field.layout === 'vertical' ? '直放' : '橫放'}</span>
			<small>建好之後不能換</small>
		</p>
		<section class="rules" class:off={!flow.timeRules.on}>
			<div class="switch">
				<label>
					<input
						type="checkbox"
						checked={flow.timeRules.on}
						onchange={(e) => update({ on: e.currentTarget.checked })}
					/>
					規則警告（只提醒，不擋）
				</label>
				<button type="button" class="ghost reset" disabled={isDefault} onclick={() => update(DEFAULT_TIME_RULES)}
					>恢復預設</button
				>
			</div>
			{#each fields as [key, label] (key)}
				<label class="num">
					{label}
					<input
						type="number"
						min="1"
						value={flow.timeRules[key]}
						onchange={(e) => setSeconds(key, label, e.currentTarget)}
					/>
				</label>
			{/each}
		</section>
		<section class="rules markers">
			<b>標記（場上、泳道、名單上寫的字）</b>
			{#each MARKER_STYLES as s (s.key)}
				<label class="radio">
					<input
						type="radio"
						name="markers"
						checked={(flow.markers ?? 'number') === s.key}
						onchange={() => ask.send(() => setMarkers(flow, s.key))}
					/>
					{s.label}
				</label>
			{/each}
			{#if flow.markers === 'initial'}
				<span class="note">開頭字一樣的人，會再多帶一個字分開。不喜歡就到「隊員」改名字。</span>
			{/if}
			{#if flow.members.length}
				<ul class="preview" aria-label="每個人的標記">
					{#each flow.members as m (m.id)}
						<li>
							<i class="no {m.globalRole}" class:long={isLongMarker(markers[m.id])}>{markers[m.id]}</i><span
								>{m.name}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="rules roles">
			<b>自訂任務角色</b>
			{#if flow.customRoles.length}
				<ul class="role-list" aria-label="自訂任務角色">
					{#each flow.customRoles as role (role.id)}
						<li>
							<input
								aria-label="「{role.name}」的名稱"
								value={role.name}
								bind:this={roleInputs[role.id]}
								onchange={(e) => renameRole(role, e.currentTarget)}
							/><CharCount field="roleName" input={roleInputs[role.id]} value={role.name} quiet />
							<button
								type="button"
								class="ghost icon"
								aria-label="刪除任務角色「{role.name}」"
								onclick={() => ask.send((o: ConfirmOption = {}) => deleteCustomRole(flow, role.id, o))}
								><Icon name="trash" size={14} /></button
							>
						</li>
					{/each}
				</ul>
			{:else}
				<span class="note">還沒有。動作裡每個人的任務角色不夠用時，在這裡加。</span>
			{/if}
			{#if ask.question}<ConfirmList {ask} />{/if}
			<!-- novalidate：名稱必填、不能重複由流程核心判斷 -->
			<form class="add-role" novalidate onsubmit={addRole}>
				<input
					aria-label="新的自訂任務角色"
					placeholder="任務角色名稱"
					bind:value={roleName}
					bind:this={roleNameInput}
				/><CharCount field="roleName" input={roleNameInput} value={roleName} />
				<button type="submit">新增任務角色</button>
			</form>
			<span class="note">改名時，動作裡的人、給這個角色的拍點一起改；意思在名詞對照表填。</span>
		</section>
		{#each Object.values(ask.fieldErrors) as error (error)}<p class="error" role="alert">{error}</p>{/each}
		{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
	{/snippet}
</Modal>

<style>
	:global(.flow-dialog) {
		width: min(420px, 100%);
		font-size: 13px;
	}
	.stack {
		display: grid;
		gap: 6px;
		font-weight: 600;
	}
	.head {
		display: flex;
		justify-content: space-between;
	}
	.stack input {
		font-size: 14px;
		font-weight: 400;
	}
	.field-info {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.field-info small {
		margin-left: auto;
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.rules {
		display: grid;
		gap: 8px;
		padding: 12px 14px;
		border-radius: 10px;
		background: var(--surface-2, #f6f8fb);
	}
	.switch {
		display: flex;
		gap: 8px;
		align-items: center;
		font-weight: 600;
		padding-bottom: 4px;
	}
	.switch label {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.reset {
		margin-left: auto;
		font-weight: 400;
		font-size: 12px;
	}
	.role-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.role-list li,
	.add-role {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.role-list input,
	.add-role input {
		width: 9em;
	}
	.num {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: center;
	}
	.rules.off .num {
		opacity: 0.5;
	}
	input[type='number'] {
		width: 6em;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.radio {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.note {
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.preview {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		max-height: 120px;
		overflow: auto;
		/* 捲得動的那一邊淡淡一層漸層（捲到底就消失），看得出下面還有人 */
		background:
			linear-gradient(var(--surface-2, #f6f8fb) 30%, transparent) top / 100% 24px no-repeat local,
			linear-gradient(transparent, var(--surface-2, #f6f8fb) 70%) bottom / 100% 24px no-repeat local,
			linear-gradient(rgba(22, 33, 58, 0.14), transparent) top / 100% 10px no-repeat scroll,
			linear-gradient(transparent, rgba(22, 33, 58, 0.14)) bottom / 100% 10px no-repeat scroll;
	}
	.preview li {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		font-size: 12px;
	}
	/* 跟名單、泳道上的圓圈一樣：顏色照全局角色。 */
	.no {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		font-size: 10px;
		font-style: normal;
		font-weight: 700;
		line-height: 1;
		border: 1.5px solid #16213a;
		background: #fff;
	}
	.no.top {
		background: var(--top, #e0664f);
		color: #fff;
	}
	/* 多字的標記：橫的膠囊，字不用縮小。 */
	.no.long {
		width: auto;
		padding: 0 4px;
		border-radius: 999px;
		font-size: 9px;
	}
	.error {
		margin: 0;
		color: var(--danger, #c8372d);
	}
</style>
