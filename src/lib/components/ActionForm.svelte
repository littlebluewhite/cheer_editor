<script lang="ts">
	// 動作表單：沒選動作時是「在播放頭新增動作」；選了動作時改那個動作，改了馬上生效。
	// 規則（跨段、重疊、至少 1 人、角色存在）都交給流程核心判斷；被擋就顯示原因並還原。
	// 會切短或拿掉拍點時，核心回「要確認」：顯示清單，按確定才改，按取消就還原。
	// 新增時，人就是選到的人（加人、移出也改選取）；「從別的動作複製人」連任務角色一起帶。
	import { untrack } from 'svelte';
	import {
		ACTION_CATEGORIES,
		actionLabel,
		actionSeconds,
		actionSlotAt,
		addAction,
		atText,
		deleteAction,
		lengthText,
		memberName,
		parseAt,
		parseLength,
		positionText,
		roleGlossary,
		segmentSpans,
		updateAction,
		type Action,
		type ActionCategory,
		type ActionMember,
		type Flow,
		type NewActionInput
	} from '#lib/core';
	import { CATEGORY_COLORS } from './category-colors';
	import ConfirmList from './ConfirmList.svelte';
	import CueGrid from './CueGrid.svelte';
	import Icon from './Icon.svelte';
	import RoleGlossary from './RoleGlossary.svelte';

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
	}

	/** 角色下拉選單裡「＋自訂角色…」的值。 */
	const NEW_ROLE = '\u0000new';

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

	let draft = $state<Draft>(blank());
	let error = $state('');
	/** 等教練確認的改動（會切短或拿掉拍點）。 */
	let pending = $state<{ input: NewActionInput; message: string; items: string[] } | null>(null);
	let glossaryOpen = $state(false);

	function blank(): Draft {
		const members = untrack(() => fromSelection([]));
		return { category: 'stunt', name: '', startText: '', lengthText: '', note: '', members };
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
			members: a.members.map((m) => ({ ...m }))
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
		const { category, name, note, members } = draft;
		return { segmentId: segment.id, category, name, start, length, note, members };
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
		const input = toInput();
		const r = typeof input === 'string' ? null : updateAction(flow, action.id, input);
		pending = null;
		if (r?.kind === 'ok') {
			error = '';
			onchange(r.flow);
			return;
		}
		if (r?.kind === 'confirm' && typeof input !== 'string') {
			error = '';
			pending = { input, message: r.message, items: r.items };
			return;
		}
		error = `${r?.message ?? input}，已還原`;
		draft = fromAction(action);
	}

	function confirmChange() {
		if (!action || !pending) return;
		const r = updateAction(flow, action.id, pending.input, { confirmed: true });
		pending = null;
		if (r.kind === 'ok') {
			onchange(r.flow);
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
		const r = deleteAction(flow, action.id);
		if (r.kind !== 'ok') return;
		onchange(r.flow);
		onselect(null);
	}

	function setRole(i: number, select: HTMLSelectElement) {
		if (select.value === NEW_ROLE) {
			select.value = draft.members[i].role ?? '';
			glossaryOpen = true;
			return;
		}
		draft.members[i].role = select.value || null;
		changed();
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

	const nameOf = (id: string) => memberName(flow, id);
</script>

<!-- 放在卡片外面：放裡面會看成是對這個動作做事 -->
{#if action}
	<button type="button" class="new" onclick={() => onselect(null)}><Icon name="plus" size={14} />新增動作</button>
{/if}

<section class="action-form" class:editing={action} style:--cat={CATEGORY_COLORS[draft.category]}>
	<header>
		<h3>
			<span class="dot"></span>
			{action ? '動作' : '在播放頭新增動作'}
		</h3>
		{#if action}
			<button type="button" class="danger" onclick={remove}><Icon name="trash" size={14} />刪除動作</button>
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
			<label class="wide">
				<span class="cap">名稱</span>
				<input bind:value={draft.name} onchange={changed} placeholder="例如：Lib、籃拋" />
			</label>
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
				<button type="button" class="link" onclick={() => (glossaryOpen = true)}>名詞對照表</button>
			</div>
			{#if draft.members.length}
				<ul>
					{#each draft.members as m, i (m.memberId)}
						<li>
							<span>{nameOf(m.memberId)}</span>
							<select
								aria-label="{nameOf(m.memberId)} 的任務角色"
								value={m.role ?? ''}
								onchange={(e) => setRole(i, e.currentTarget)}
							>
								<option value="">（沒有任務）</option>
								{#each roles as r (r.name)}<option value={r.name}>{r.name}</option>{/each}
								<option value={NEW_ROLE}>＋自訂角色…</option>
							</select>
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
						<option value="">從別的動作複製人（連任務角色）…</option>
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
			<CueGrid {flow} {action} {onchange} />
		{:else}
			<button type="button" class="primary add" onclick={add}>新增動作</button>
		{/if}
	{/if}

	{#if pending}
		<ConfirmList
			message={pending.message}
			items={pending.items}
			confirmLabel="確定"
			onconfirm={confirmChange}
			oncancel={cancelChange}
		/>
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
		gap: 12px;
		font-size: 13px;
		padding: 14px;
		border-radius: 12px;
		background: var(--surface-2, #f6f8fb);
		border: 1px solid var(--line-soft, #e8ecf3);
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	h3 {
		margin: 0 auto 0 0;
		font-size: 14px;
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--cat);
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
	li > span {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li .icon {
		width: 26px;
		height: 26px;
		color: var(--muted, #66718a);
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
	.error {
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
