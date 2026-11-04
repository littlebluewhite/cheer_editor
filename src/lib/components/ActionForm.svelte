<script lang="ts">
	// 動作表單：沒選動作時是新增（卡片標「新動作」、換底色，開始跟著播放頭）；選了動作時改那個動作，改了馬上生效。
	// 卡片的標題就是名稱輸入框；辨識色沒挑就用大類的顏色。
	// 規則（跨段、重疊、至少 1 人、角色存在）都交給流程核心判斷；被擋就顯示原因並還原。
	// 會切短或拿掉拍點時，核心回「要確認」：顯示清單，按確定才改，按取消就還原。
	// 會清掉紀錄時也一樣先問；有紀錄的組換了人，核心回「要選」：保留舊紀錄、清掉重算、取消。
	// 新增時，人就是選到的人（加人、移出也改選取）；「從別的動作複製人」連任務角色和組一起帶。
	// 改動作時多一區「成功率」：開關記成功率、環節清單（PhaseList）；打開後（騰翻、跳躍除外）每個人旁邊選第幾組。
	import { untrack } from 'svelte';
	import {
		ACTION_CATEGORIES,
		actionLabel,
		actionSeconds,
		actionSlotAt,
		addAction,
		atText,
		deleteAction,
		disableSuccessRate,
		enableSuccessRate,
		lengthText,
		memberName,
		parseAt,
		parseLength,
		perPerson,
		positionText,
		roleGlossary,
		segmentSpans,
		setSquad,
		updateAction,
		type Action,
		type ActionCategory,
		type ActionMember,
		type CommandResult,
		type ConfirmOption,
		type Flow,
		type NewActionInput
	} from '#lib/core';
	import { ACTION_COLORS, actionColor, CATEGORY_COLORS } from './category-colors';
	import ConfirmList from './ConfirmList.svelte';
	import CueGrid from './CueGrid.svelte';
	import { applyResult } from './form';
	import Icon from './Icon.svelte';
	import PhaseList from './PhaseList.svelte';
	import RoleGlossary from './RoleGlossary.svelte';
	import RolePicker, { roleKey } from './RolePicker.svelte';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。新動作從這裡開始。 */
		playheadSec: number;
		/** 選到的動作；null = 新增。 */
		actionId: string | null;
		onchange: (flow: Flow) => void;
		onselect: (actionId: string | null) => void;
		/** 選到的人；新增時就是新動作的人。 */
		selectedMemberIds?: string[];
		onselectmembers?: (memberIds: string[]) => void;
	}

	let {
		flow,
		playheadSec,
		actionId,
		onchange,
		onselect,
		selectedMemberIds = [],
		onselectmembers = () => {}
	}: Props = $props();

	interface Draft {
		category: ActionCategory;
		name: string;
		startText: string;
		lengthText: string;
		note: string;
		members: ActionMember[];
		/** 辨識色；undefined = 用大類的顏色。 */
		color: string | undefined;
	}

	const action = $derived(actionId ? (flow.actions.find((a) => a.id === actionId) ?? null) : null);
	const slot = $derived(action ? null : actionSlotAt(flow, playheadSec));
	const segment = $derived(
		flow.segments.find((s) => s.id === (action?.segmentId ?? slot?.segmentId)) ?? null
	);
	const segmentLabel = $derived(
		segmentSpans(flow).find((s) => s.segment.id === segment?.id)?.label ?? ''
	);
	/** 播放頭換格才變，用來在新增時把開始、長度跟上播放頭。 */
	const slotKey = $derived(slot ? `${slot.segmentId}:${slot.start}:${slot.length}` : '');
	const roles = $derived(roleGlossary(flow));
	/** 每個人的任務角色選單，按快捷鍵後跳到下一個。 */
	const rolePickers: RolePicker[] = $state([]);
	const others = $derived(
		flow.members.filter((m) => !draft.members.some((d) => d.memberId === m.id))
	);
	/** 「從別的動作複製人」的選項：其他動作，照時間排。 */
	const copySources = $derived(
		flow.actions
			.filter((a) => a.id !== action?.id)
			.map((a) => ({ a, sec: actionSeconds(flow, a).startSec }))
			.sort((x, y) => x.sec - y.sec)
			.map(({ a, sec }) => ({
				id: a.id,
				label: `${positionText(flow, sec)}　${actionLabel(a)}（${a.members.length} 人）`
			}))
	);

	/** 「第幾組」選單的組：1 到現在最大的組再多一組。沒打開記成功率、或騰翻跳躍（不分組）是空的，不顯示選單。 */
	const squadChoices = $derived.by(() => {
		if (!action?.successRate || perPerson(action.category)) return [];
		const max = Math.max(0, ...action.members.map((m) => m.squad ?? 0));
		return Array.from({ length: max + 1 }, (_, i) => i + 1);
	});

	let draft = $state<Draft>(blank());
	let error = $state('');
	/**
	 * 等教練確認的改動（會切短或拿掉拍點、會清掉紀錄）。send 帶著教練的回答再送一次同一個指令，成功後跑 after；
	 * choose 是兩個選擇的確認（保留舊紀錄／清掉重算）。
	 */
	let pending = $state<{
		message: string;
		items: string[];
		choose: boolean;
		send: (options: ConfirmOption) => CommandResult;
		after?: () => void;
	} | null>(null);
	let glossaryOpen = $state(false);
	/** 「!」說明點一下打開（iPad 沒有滑鼠移上去）。 */
	let legendOpen = $state(false);

	function blank(): Draft {
		const members = untrack(() => fromSelection([]));
		return { category: 'stunt', name: '', startText: '', lengthText: '', note: '', members, color: undefined };
	}

	/** 選到的人當新動作的人；已經在表單裡的人保留任務角色。 */
	function fromSelection(current: ActionMember[]): ActionMember[] {
		return selectedMemberIds
			.filter((id) => flow.members.some((m) => m.id === id))
			.map((id) => current.find((m) => m.memberId === id) ?? { memberId: id, role: null });
	}

	function fromAction(a: Action): Draft {
		const seg = flow.segments.find((s) => s.id === a.segmentId)!;
		return {
			category: a.category,
			name: a.name,
			startText: atText(seg, a.start),
			lengthText: lengthText(seg, a.length),
			note: a.note,
			members: a.members.map((m) => ({ ...m })),
			color: a.color
		};
	}

	// 換選到的動作（或回到新增）時重設表單。
	$effect(() => {
		const a = action;
		untrack(() => {
			draft = a ? fromAction(a) : blank();
			error = '';
			pending = null;
		});
	});

	// 新增時，人跟著選取。
	$effect(() => {
		void selectedMemberIds;
		if (action) return;
		untrack(() => (draft.members = fromSelection(draft.members)));
	});

	// 新增時，開始和長度跟著播放頭。
	$effect(() => {
		if (!slotKey) return;
		untrack(() => {
			if (!slot || !segment) return;
			draft.startText = atText(segment, slot.start);
			draft.lengthText = lengthText(segment, slot.length);
		});
	});

	function toInput(): NewActionInput | string {
		if (!segment) return '找不到這一段';
		const start = parseAt(segment, draft.startText);
		if (start === null) {
			return segment.kind === 'music' ? '開始時間看不懂，例：3-5&' : '開始時間看不懂，請打秒數';
		}
		const length = parseLength(segment, draft.lengthText);
		if (length === null) return '長度看不懂';
		const { category, name, note, members, color } = draft;
		return { segmentId: segment.id, category, name, start, length, note, members, color };
	}

	function add() {
		const input = toInput();
		const r = typeof input === 'string' ? null : addAction(flow, input);
		if (!r || r.kind !== 'ok') {
			error = r?.message ?? (input as string);
			return;
		}
		error = '';
		onchange(r.flow);
		onselect(r.id);
	}

	/** 改選到的動作：馬上送給流程核心；被擋就還原。新增時什麼都不做（等按「新增動作」）。 */
	function changed() {
		if (!action) return;
		const id = action.id;
		const input = toInput();
		const r = typeof input === 'string' ? null : updateAction(flow, id, input);
		pending = null;
		if (r?.kind === 'ok') {
			error = '';
			onchange(r.flow);
			return;
		}
		if (r && typeof input !== 'string' && ask(r, (o) => updateAction(flow, id, input, o))) return;
		error = `${r?.message ?? input}，已還原`;
		draft = fromAction(action);
	}

	/** 核心要確認（或要選保留／清掉）就先問，回 true；send 是帶著回答再送一次。 */
	function ask(r: CommandResult, send: (options: ConfirmOption) => CommandResult, after?: () => void): boolean {
		if (r.kind !== 'confirm' && r.kind !== 'choose') return false;
		error = '';
		pending = { message: r.message, items: r.items, choose: r.kind === 'choose', send, after };
		return true;
	}

	function confirmChange(options: ConfirmOption) {
		if (!action || !pending) return;
		const { send, after } = pending;
		const r = send(options);
		pending = null;
		if (r.kind === 'ok') {
			onchange(r.flow);
			after?.();
			return;
		}
		// 等確認的時候流程變了、再送一次被擋：跟別的被擋一樣寫原因再還原。
		error = `${r.message}，已還原`;
		draft = fromAction(action);
	}

	function cancelChange() {
		pending = null;
		if (action) draft = fromAction(action);
	}

	function remove() {
		if (!action) return;
		const id = action.id;
		const send = (o: ConfirmOption = {}) => deleteAction(flow, id, o);
		const r = send();
		if (r.kind !== 'ok') return void ask(r, send, () => onselect(null));
		onchange(r.flow);
		onselect(null);
	}

	/** 選了任務角色；按快捷鍵選的就跳到下一個人。 */
	function setRole(i: number, role: string | null, byKey: boolean) {
		draft.members[i].role = role;
		changed();
		if (byKey) rolePickers[i + 1]?.focus();
	}

	/** 人改了：改動作就馬上生效；新增時改選取。 */
	function membersChanged() {
		if (action) changed();
		else onselectmembers(draft.members.map((m) => m.memberId));
	}

	function addMember(select: HTMLSelectElement) {
		if (!select.value) return;
		draft.members.push({ memberId: select.value, role: null });
		select.value = '';
		membersChanged();
	}

	function removeMember(i: number) {
		draft.members.splice(i, 1);
		membersChanged();
	}

	/** 把別的動作的人連任務角色一起換進來。 */
	function copyFrom(select: HTMLSelectElement) {
		const source = flow.actions.find((a) => a.id === select.value);
		select.value = '';
		if (!source) return;
		draft.members = source.members.map((m) => ({ ...m }));
		membersChanged();
	}

	function setColor(color: string | undefined) {
		draft.color = color;
		changed();
	}

	/** 要問或被擋時，開關先回到原來的樣子（確定了才關）。 */
	function toggleSuccessRate(box: HTMLInputElement) {
		if (!action) return;
		const id = action.id;
		const on = box.checked;
		const send = (o: ConfirmOption = {}) => (on ? enableSuccessRate(flow, id) : disableSuccessRate(flow, id, o));
		const r = send();
		if (r.kind !== 'ok') box.checked = !on;
		if (!ask(r, send)) error = applyResult(r, onchange);
	}

	/** 選單的值：空字串是沒分組。要問或被擋時，選單先回到原來的組。 */
	function pickSquad(memberId: string, select: HTMLSelectElement) {
		if (!action) return;
		const id = action.id;
		const squad = select.value ? Number(select.value) : null;
		const send = (o: ConfirmOption = {}) => setSquad(flow, id, memberId, squad, o);
		const r = send();
		if (r.kind !== 'ok') select.value = String(action.members.find((m) => m.memberId === memberId)?.squad ?? '');
		if (!ask(r, send)) error = applyResult(r, onchange);
	}

	const nameOf = (id: string) => memberName(flow, id);
	const memberOf = (id: string) => flow.members.find((m) => m.id === id);
</script>

<!-- 放在卡片外面：放裡面會看成是對這個動作做事 -->
{#if action}
	<button type="button" class="new" onclick={() => onselect(null)}><Icon name="plus" size={14} />新增動作</button>
{/if}

<section class="action-form" class:creating={!action} style:--cat={actionColor(draft)}>
	<header>
		<span class="dot"></span>
		<input
			class="title"
			aria-label="名稱"
			bind:value={draft.name}
			onchange={changed}
			placeholder={action ? '幫這個動作取名字' : '新動作的名稱，例如：Lib、籃拋'}
		/>
		{#if action}
			<button type="button" class="danger" onclick={remove}><Icon name="trash" size={14} />刪除動作</button>
		{:else}
			<span class="badge">新動作</span>
		{/if}
	</header>

	{#if !segment}
		<p class="empty">先加一段才能加動作：在下面的時間軸按「＋」。</p>
	{:else}
		<p class="seg">在 <b>{segmentLabel}</b> 裡<span class="muted">（動作不能跨段）</span></p>
		<div class="grid">
			<label class="wide">
				<span class="cap">大類</span>
				<select
					value={draft.category}
					onchange={(e) => {
						draft.category = e.currentTarget.value as ActionCategory;
						changed();
					}}
				>
					{#each ACTION_CATEGORIES as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
				</select>
			</label>
			<fieldset class="wide colors">
				<legend class="cap">辨識色</legend>
				<label class="swatch auto" title="大類的顏色" style:--c={CATEGORY_COLORS[draft.category]}>
					<input
						type="radio"
						name="action-color"
						aria-label="大類的顏色"
						checked={!draft.color}
						onchange={() => setColor(undefined)}
					/>照大類
				</label>
				{#each ACTION_COLORS as c (c.value)}
					<label class="swatch" title={c.label} style:--c={c.value}>
						<input
							type="radio"
							name="action-color"
							aria-label={c.label}
							checked={draft.color === c.value}
							onchange={() => setColor(c.value)}
						/>
					</label>
				{/each}
			</fieldset>
			<div class="field">
				<span class="cap" aria-hidden="true">開始</span>
				<input aria-label="開始" bind:value={draft.startText} onchange={changed} />
				<small>{segment.kind === 'music' ? '八拍-拍，例：3-5&' : '秒，到 0.1'}</small>
			</div>
			<div class="field">
				<span class="cap" aria-hidden="true">長度</span>
				<input aria-label="長度" bind:value={draft.lengthText} onchange={changed} />
				<small>{segment.kind === 'music' ? '拍（8 拍＝1 個八拍）' : '秒'}</small>
			</div>
		</div>

		<div class="people">
			<div class="people-head">
				<span class="cap">人（{draft.members.length}）＋任務角色</span>
				<span class="legend">
					<button
						type="button"
						class="ghost bang"
						aria-label="顏色和快捷鍵說明"
						aria-describedby="people-legend"
						aria-expanded={legendOpen}
						onclick={() => (legendOpen = !legendOpen)}
						onfocusout={() => (legendOpen = false)}>!</button
					>
					<span class="tip" id="people-legend" role="tooltip">
						<span><b class="name F">名字</b>女　<b class="name M">名字</b>男</span>
						<span><i class="gr base">底</i>底層　<i class="gr top">上</i>上層（隊員名單裡的全局角色）</span>
						<span>點任務角色選單後按鍵就選好，跳到下一個人：</span>
						<span class="keys">
							{#each roles as r, k (r.name)}{#if roleKey(k)}<kbd>{roleKey(k)} {r.name}</kbd>{/if}{/each}
							<kbd>Backspace 沒有任務</kbd>
						</span>
					</span>
				</span>
				<button type="button" class="link" onclick={() => (glossaryOpen = true)}>名詞對照表</button>
			</div>
			{#if draft.members.length}
				<ul class:grouped={squadChoices.length > 0}>
					{#each draft.members as m, i (m.memberId)}
						{@const who = memberOf(m.memberId)}
						<li>
							<span class="who">
								{#if who}<i class="gr {who.globalRole}">{who.globalRole === 'top' ? '上' : '底'}</i>{/if}
								<span class="name {who?.gender ?? ''}">{nameOf(m.memberId)}</span>
							</span>
							<RolePicker
								bind:this={rolePickers[i]}
								label="{nameOf(m.memberId)} 的任務角色"
								value={m.role}
								names={roles.map((r) => r.name)}
								onpick={(role, byKey) => setRole(i, role, byKey)}
								onnew={() => (glossaryOpen = true)}
							/>
							{#if squadChoices.length}
								<select
									class="squad"
									aria-label="{nameOf(m.memberId)} 的組"
									value={m.squad ?? ''}
									onchange={(e) => pickSquad(m.memberId, e.currentTarget)}
								>
									<option value="">沒有</option>
									{#each squadChoices as n (n)}<option value={n}>第 {n} 組</option>{/each}
								</select>
							{/if}
							<button
								type="button"
								class="ghost icon"
								aria-label="把 {nameOf(m.memberId)} 移出這個動作"
								onclick={() => removeMember(i)}><Icon name="close" size={14} /></button
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted none">還沒有人：用上面的「選人」，或在場上點人。</p>
			{/if}
			<div class="adders">
				<select aria-label="加人" onchange={(e) => addMember(e.currentTarget)}>
					<option value="">＋加人…</option>
					{#each others as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
				</select>
				{#if copySources.length}
					<select aria-label="從別的動作複製人" onchange={(e) => copyFrom(e.currentTarget)}>
						<option value="">從別的動作複製人（連任務角色和組）…</option>
						{#each copySources as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
					</select>
				{/if}
			</div>
		</div>

		<label class="note">
			<span class="cap">備註</span>
			<textarea rows="2" bind:value={draft.note} onchange={changed}></textarea>
		</label>

		{#if action}
			<div class="rate" role="group" aria-label="成功率">
				<div class="rate-head">
					<span class="cap">成功率</span>
					<label class="switch">
						<input
							type="checkbox"
							checked={!!action.successRate}
							onchange={(e) => toggleSuccessRate(e.currentTarget)}
						/>記成功率
					</label>
				</div>
				{#if action.successRate}
					<PhaseList {flow} {action} {onchange} />
				{/if}
			</div>
			<CueGrid {flow} {action} {onchange} />
		{:else}
			<button type="button" class="primary add" onclick={add}>新增動作</button>
		{/if}
	{/if}

	<!-- 問句在拍點格子下面，常在看得到的範圍外：出現時捲過去。 -->
	{#if pending}
		<div {@attach (d) => d.scrollIntoView({ block: 'nearest' })}>
			<ConfirmList
				message={pending.message}
				items={pending.items}
				confirmLabel={pending.choose ? '清掉重算' : '確定'}
				onconfirm={() => confirmChange(pending?.choose ? { records: 'clear' } : { confirmed: true })}
				onkeep={pending.choose ? () => confirmChange({ records: 'keep' }) : undefined}
				oncancel={cancelChange}
			/>
		</div>
	{/if}

	<!-- 右邊欄很長時原因會在看得到的範圍下面，按了像沒反應：出現時捲過去。 -->
	{#if error}<p class="error" role="alert" {@attach (p) => p.scrollIntoView({ block: 'nearest' })}>{error}</p>{/if}
</section>

{#if glossaryOpen}
	<RoleGlossary {flow} {onchange} onclose={() => (glossaryOpen = false)} />
{/if}

<style>
	.action-form {
		display: grid;
		/* 標題的名稱輸入框不撐寬右邊欄 */
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
		font-size: 13px;
		padding: 14px;
		border-radius: 12px;
		background: var(--surface-2, #f6f8fb);
		border: 1px solid var(--line-soft, #e8ecf3);
		/* 左邊一條動作的顏色（辨識色或大類），跟泳道上的色條對得起來。 */
		border-left: 4px solid var(--cat);
	}
	/* 新增：換成淡綠底、虛線框，一眼看得出是還沒加進去的新動作。 */
	.action-form.creating {
		background: var(--new-bg);
		border: 1px dashed var(--new-line);
		border-left: 4px solid var(--cat);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: var(--cat);
	}
	/* 名稱就是標題：平常看起來像字，滑過去、點進去才像輸入框。 */
	.title {
		flex: 1;
		min-width: 0;
		padding: 4px 6px;
		margin-left: -2px;
		font-size: 16px;
		font-weight: 700;
		color: var(--text, #1a2238);
		background: transparent;
		border-color: transparent;
	}
	.title:hover {
		border-color: var(--line, #d8dee9);
	}
	.title:focus {
		background: var(--surface, #fff);
	}
	.title::placeholder {
		font-size: 14px;
		font-weight: 500;
	}
	.badge {
		flex: none;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--new-line);
		color: #fff;
		font-size: 12px;
		font-weight: 700;
	}
	.new {
		width: 100%;
		justify-content: center;
		border-style: dashed;
	}
	.danger {
		padding: 3px 8px;
		font-size: 12px;
	}
	p {
		margin: 0;
	}
	.seg {
		color: var(--text, #1a2238);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.grid label,
	.field,
	.note {
		display: grid;
		gap: 4px;
		align-content: start;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.colors {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		margin: 0;
		padding: 0;
		border: none;
		min-width: 0;
	}
	.colors legend {
		float: left;
		width: 100%;
		margin-bottom: 4px;
		padding: 0;
	}
	.swatch {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--c);
		cursor: pointer;
	}
	.swatch.auto {
		width: auto;
		padding: 0 8px;
		border-radius: 999px;
		color: #fff;
		font-size: 11px;
		font-weight: 600;
	}
	.swatch input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.swatch:has(input:checked) {
		box-shadow:
			0 0 0 2px var(--surface, #fff),
			0 0 0 4px var(--ink, #16213a);
	}
	.swatch:has(input:focus-visible) {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: 4px;
	}
	.cap {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	small {
		font-size: 11px;
		color: var(--muted, #66718a);
	}
	.grid input,
	.grid select,
	.note textarea {
		width: 100%;
	}
	.field input {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.muted {
		color: var(--muted, #66718a);
	}
	.empty {
		padding: 12px;
		border-radius: 8px;
		border: 1px dashed var(--line, #d8dee9);
		color: var(--muted, #66718a);
		text-align: center;
	}
	.people {
		background: var(--surface, #fff);
		border: 1px solid var(--line-soft, #e8ecf3);
		border-radius: 10px;
		padding: 10px;
		display: grid;
		gap: 8px;
	}
	.people-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.people-head .link {
		font-size: 12px;
	}
	.none {
		font-size: 12px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto;
		gap: 6px;
		align-items: center;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 1px 8px;
		border-radius: 999px;
	}
	.name.F {
		background: var(--female-bg, #ffe0ea);
	}
	.name.M {
		background: var(--male-bg, #dcebff);
	}
	.gr {
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		font-size: 11px;
		font-style: normal;
		font-weight: 700;
		color: #fff;
	}
	.gr.base {
		background: var(--base, #2c3e66);
	}
	.gr.top {
		background: var(--top, #e0664f);
	}
	.people-head .cap {
		margin-right: auto;
	}
	.legend {
		position: relative;
		margin-right: 8px;
	}
	.bang {
		width: 20px;
		height: 20px;
		padding: 0;
		border-radius: 50%;
		border: 1.5px solid var(--muted, #66718a);
		color: var(--muted, #66718a);
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
	}
	.tip {
		display: none;
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 10;
		width: max-content;
		max-width: min(320px, 80vw);
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--surface, #fff);
		box-shadow: var(--shadow-pop);
		font-size: 12px;
		gap: 6px;
	}
	.legend:hover .tip,
	.bang:focus-visible + .tip,
	.bang[aria-expanded='true'] + .tip {
		display: grid;
	}
	.tip > span {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.tip .name {
		font-weight: 600;
	}
	kbd {
		font-family: inherit;
		font-size: 11px;
		padding: 1px 6px;
		border: 1px solid var(--line, #d8dee9);
		border-radius: 4px;
		background: var(--surface-2, #f6f8fb);
	}
	li .icon {
		width: 26px;
		height: 26px;
		color: var(--muted, #66718a);
	}
	/* 打開記成功率：任務角色和移出鈕中間多一個「第幾組」選單 */
	ul.grouped li {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto auto;
	}
	.squad {
		padding-inline: 4px;
		font-size: 12px;
	}
	.rate {
		background: var(--surface, #fff);
		border: 1px solid var(--line-soft, #e8ecf3);
		border-radius: 10px;
		padding: 10px;
		display: grid;
		gap: 8px;
	}
	.rate-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		cursor: pointer;
	}
	.adders {
		display: grid;
		gap: 6px;
	}
	.adders select {
		width: 100%;
		background-color: var(--surface-2, #f6f8fb);
		border-style: dashed;
	}
	.add {
		width: 100%;
		padding: 8px 12px;
		font-size: 14px;
	}
	/* 右邊欄夠寬時：大類、開始、長度排一列，辨識色在下一列；人分兩欄。少捲一點。 */
	@container (min-width: 600px) {
		.grid {
			grid-template-columns: 2fr 1fr 1fr;
		}
		.grid > label.wide {
			grid-column: 1;
			grid-row: 1;
		}
		.grid > .field {
			grid-row: 1;
		}
		.grid > .colors {
			grid-row: 2;
		}
		ul {
			grid-template-columns: 1fr 1fr;
			column-gap: 16px;
		}
		.adders {
			grid-template-columns: 1fr 1fr;
		}
	}
	.error {
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
