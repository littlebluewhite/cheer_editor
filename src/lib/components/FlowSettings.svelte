<script lang="ts">
	// 流程設定：流程名字、調整場地（改條數或鋪向）、規則警告的開關和三個數字（可以恢復預設）、
	// 標記用號碼還是開頭字、自訂任務角色（新增、改名、刪除）。被擋就顯示流程核心給的原因。
	// 欄位按 Enter 就套用；改了場地沒按「調整場地」就關，照樣調整（關掉就套用）。
	import { getEditor } from '#lib/editor.svelte.js';
	import { composing } from '#lib/ime.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		DEFAULT_TIME_RULES,
		memberMarkers,
		MAX_STRIPS,
		MIN_STRIPS,
		type FieldLayout,
		type MarkerStyle,
		type TimeRules
	} from '#lib/core';
	import CharCount from './CharCount.svelte';
	import ConfirmList from './ConfirmList.svelte';
	import { commitField, customRoleNameField } from './commit-field';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { isLongMarker } from '#lib/marker.js';
	import { m } from '#lib/paraglide/messages.js';
	import { revealAlert } from './reveal';

	interface Props {
		onclose: () => void;
		/** 打開時焦點放在哪一格：規則警告的開關，或某一個秒數（點規則警告時帶到那一格）。 */
		focus?: 'on' | (typeof fields)[number][0];
	}

	let { onclose, focus }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 被擋的原因，和刪有人用的自訂任務角色時等教練確認的清單。 */
	const ask = session.changeAsk({ confirmLabel: m.segment_confirm_delete() });
	let nameInput = $state<HTMLInputElement>();
	/** 新的自訂任務角色名稱。 */
	let roleName = $state('');
	let roleNameInput = $state<HTMLInputElement>();
	/** 每個自訂任務角色的名稱欄（旁邊的字數要看它），照角色 id。 */
	const roleInputs = $state<Record<string, HTMLInputElement>>({});
	const isDefault = $derived(
		(Object.keys(DEFAULT_TIME_RULES) as (keyof TimeRules)[]).every((k) => flow.timeRules[k] === DEFAULT_TIME_RULES[k])
	);

	function addRole(e: SubmitEvent) {
		e.preventDefault();
		ask.send({ name: 'addCustomRole', args: [{ name: roleName, meaning: '' }] }, { done: () => (roleName = '') });
	}

	// 調整場地的兩個欄位；流程的場地變了（調整、復原）就跟著變。
	let strips = $derived(flow.field.strips);
	let layout = $derived<FieldLayout>(flow.field.layout);
	const fieldSame = $derived(strips === flow.field.strips && layout === flow.field.layout);
	/** 調整場地自己的問題：會有人疊在一起時問「照樣調整」，被擋的原因寫在場地旁邊。 */
	const fieldAsk = session.changeAsk({ confirmLabel: m.flow_settings_adjust_anyway() });

	/** 調整好了的提醒：吸附會丟掉原本的位置，再調回原本的場地也回不去（N31）。對話框裡寫一次，也接在「已調整場地」的提示後面（旁邊有復原）。 */
	const SNAPPED_NOTE = m.flow_settings_snapped_note();
	const SNAPPED = m.flow_settings_snapped();
	let fieldNote = $state('');

	/** 調整場地；被擋或取消就把兩個欄位退回現在的場地。 */
	function applyField() {
		fieldNote = '';
		return fieldAsk.send({ name: 'adjustField', args: [{ strips, layout }] }, {
			done: () => {
				if (!flow.members.length) return;
				fieldNote = SNAPPED;
				session.noteChange(SNAPPED_NOTE);
			},
			revert: () => {
				strips = flow.field.strips;
				layout = flow.field.layout;
			}
		});
	}

	/** 關之前：場地改了沒按「調整場地」就照樣調整；被擋、要問就先不關。
	 *  正在問時按 ×＝取消（退回）並關掉：Modal 先把 fieldAsk 的確認框取消，這裡就跟沒改一樣（N39）。 */
	function beforeclose(): boolean {
		return fieldSame || applyField().kind === 'ok';
	}

	const { pendingInput } = getEditor().adapters;

	/** 欄位按 Enter：跟離開欄位一樣送出（條數欄是調整場地）。 */
	function onenter(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (e.key !== 'Enter' || composing(e)) return;
		e.preventDefault();
		if (e.currentTarget.dataset.strips !== undefined) {
			if (!fieldSame) applyField();
		} else pendingInput.flush();
	}

	function update(patch: Partial<TimeRules>) {
		ask.send({ name: 'updateTimeRules', args: [patch] });
	}

	/** 一個秒數；被擋就把那一格還原成實際的值，原因記在那一格（空白、看不懂是 NaN，交給流程核心擋）。 */
	function secondsField(key: (typeof fields)[number][0], label: string) {
		return commitField(ask, label, {
			send: (text) => ({ name: 'updateTimeRules', args: [{ [key]: parseFloat(text) }] }),
			actual: () => String(flow.timeRules[key])
		});
	}

	/** 流程名字；被擋下時把輸入框還原成原本的名字。 */
	const nameField = commitField(ask, m.text_length_flow_name(), { send: (text) => ({ name: 'renameFlow', args: [text] }), actual: () => flow.name });

	const markers = $derived(memberMarkers(flow));
	const MARKER_STYLES: { key: MarkerStyle; label: string }[] = [
		{ key: 'number', label: m.flow_settings_marker_number() },
		{ key: 'initial', label: m.flow_settings_marker_initial() }
	];

	const fields = [
		['minChantSec', m.flow_settings_min_chant()],
		['maxMusicSec', m.flow_settings_max_music()],
		['maxTotalSec', m.flow_settings_max_total()]
	] as const;
</script>

<Modal label={m.flow_settings_title()} class="dialog flow-dialog" {ask} confirms={[fieldAsk]} {onclose} {beforeclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>{m.flow_settings_title()}</h2>
			<button type="button" class="ghost icon close" aria-label={m.flow_settings_close()} onclick={close}><Icon name="close" /></button>
		</header>
		<label class="stack">
			<span class="head">{m.text_length_flow_name()}<CharCount field="flowName" input={nameInput} value={flow.name} /></span>
			<input
				aria-label={m.text_length_flow_name()}
				value={flow.name}
				bind:this={nameInput}
				{@attach nameField}
				onkeydown={onenter}
			/>
		</label>
		<section class="rules field">
			<b
				>{m.flow_settings_field()}<span class="now"
					>{(flow.field.layout === 'vertical'
						? flow.field.strips === 1
							? m.flow_settings_now_vertical_one
							: m.flow_settings_now_vertical
						: flow.field.strips === 1
							? m.flow_settings_now_horizontal_one
							: m.flow_settings_now_horizontal)({ n: flow.field.strips })}</span
				></b
			>
			<div class="field-row">
				<label>
					{m.flow_settings_strips()}
					<input
						type="number"
						min={MIN_STRIPS}
						max={MAX_STRIPS}
						step="1"
						data-strips
						bind:value={strips}
						onkeydown={onenter}
					/>
				</label>
				<label class="radio"><input type="radio" name="layout" value="vertical" bind:group={layout} />{m.flow_settings_vertical()}</label>
				<label class="radio"><input type="radio" name="layout" value="horizontal" bind:group={layout} />{m.flow_settings_horizontal()}</label>
				<button
					type="button"
					class="adjust"
					disabled={fieldSame}
					onclick={applyField}>{m.change_label_field()}</button
				>
			</div>
			<span class="note">{m.flow_settings_field_note()}</span>
			{#if fieldAsk.question}<ConfirmList ask={fieldAsk} />{/if}
			{#if fieldAsk.error}<p class="error" {@attach revealAlert(fieldAsk.failures)}>{fieldAsk.error}</p>{/if}
			{#if fieldNote}<p class="note" role="status">{fieldNote}</p>{/if}
		</section>
		<section class="rules" class:off={!flow.timeRules.on}>
			<div class="switch">
				<label>
					<input
						type="checkbox"
						data-autofocus={focus === 'on' || undefined}
						checked={flow.timeRules.on}
						onchange={(e) => update({ on: e.currentTarget.checked })}
					/>
					{m.flow_settings_rules()}
				</label>
				<button type="button" class="ghost reset" disabled={isDefault} onclick={() => update(DEFAULT_TIME_RULES)}
					>{m.flow_settings_reset()}</button
				>
			</div>
			{#if !flow.timeRules.on}
				<span class="note">{m.flow_settings_rules_off()}</span>
			{/if}
			{#each fields as [key, label] (key)}
				<label class="num">
					{label}
					<input
						type="number"
						min="1"
						data-autofocus={focus === key || undefined}
						value={flow.timeRules[key]}
						{@attach secondsField(key, label)}
						onkeydown={onenter}
					/>
				</label>
			{/each}
		</section>
		<section class="rules markers">
			<b>{m.flow_settings_markers()}</b>
			{#each MARKER_STYLES as s (s.key)}
				<label class="radio">
					<input
						type="radio"
						name="markers"
						checked={(flow.markers ?? 'number') === s.key}
						onchange={() => ask.send({ name: 'setMarkers', args: [s.key] })}
					/>
					{s.label}
				</label>
			{/each}
			{#if flow.markers === 'initial'}
				<span class="note">{m.flow_settings_initial_note()}</span>
			{/if}
			{#if flow.members.length}
				<ul class="preview" aria-label={m.flow_settings_marker_preview()}>
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
			<b>{m.flow_settings_custom_roles()}</b>
			{#if flow.customRoles.length}
				<ul class="role-list" aria-label={m.flow_settings_custom_roles()}>
					{#each flow.customRoles as role (role.id)}
						<li>
							<input
								aria-label={m.flow_settings_role_name({ name: role.name })}
								value={role.name}
								bind:this={roleInputs[role.id]}
								{@attach customRoleNameField(ask, role)}
								onkeydown={onenter}
							/><CharCount field="roleName" input={roleInputs[role.id]} value={role.name} quiet />
							<button
								type="button"
								class="ghost icon"
								aria-label={m.flow_settings_delete_role({ name: role.name })}
								onclick={() => ask.send({ name: 'deleteCustomRole', args: [role.id] })}
								><Icon name="trash" size={14} /></button
							>
						</li>
					{/each}
				</ul>
			{:else}
				<span class="note">{m.flow_settings_no_roles()}</span>
			{/if}
			{#if ask.question}<ConfirmList {ask} />{/if}
			<!-- novalidate：名稱必填、不能重複由流程核心判斷 -->
			<form class="add-role" data-native-undo novalidate onsubmit={addRole}>
				<input
					aria-label={m.flow_settings_new_role()}
					placeholder={m.text_length_role_name()}
					bind:value={roleName}
					bind:this={roleNameInput}
				/><CharCount field="roleName" input={roleNameInput} value={roleName} />
				<button type="submit">{m.flow_settings_add_role()}</button>
			</form>
			<span class="note">{m.flow_settings_roles_note()}</span>
		</section>
		{#each Object.values(ask.fieldErrors) as error (error)}<p class="error" {@attach revealAlert(ask.failures)}>{error}</p>{/each}
		{#if ask.error}<p class="error" {@attach revealAlert(ask.failures)}>{ask.error}</p>{/if}
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
	.now {
		margin-left: 8px;
		font-weight: 400;
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.field-row {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
	}
	.field-row label {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.adjust {
		margin-left: auto;
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
