<script lang="ts">
	// 動作表單：沒選動作時是「在播放頭新增動作」；選了動作時改那個動作，改了馬上生效。
	// 規則（跨段、重疊、至少 1 人、角色存在）都交給流程核心判斷；被擋就顯示原因並還原。
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
		if (!r || r.kind === 'blocked') {
			error = r?.message ?? (input as string);
			return;
		}
		error = '';
		onchange(r.flow);
		onselect(r.flow.actions.at(-1)!.id);
	}

	/** 改選到的動作：馬上送給流程核心；被擋就還原。新增時什麼都不做（等按「新增動作」）。 */
	function changed() {
		if (!action) return;
		const input = toInput();
		const r = typeof input === 'string' ? null : updateAction(flow, action.id, input);
		if (r?.kind === 'ok') {
			error = '';
			onchange(r.flow);
			return;
		}
		error = `${r?.message ?? input}，已還原`;
		draft = fromAction(action);
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

	const nameOf = (id: string) => flow.members.find((m) => m.id === id)?.name ?? id;
</script>

<section class="action-form">
	<header>
		<h3>
			<span class="dot" style:color={CATEGORY_COLORS[draft.category]}>●</span>
			{action ? '動作' : '在播放頭新增動作'}
		</h3>
		{#if action}<button type="button" class="danger" onclick={remove}>刪除動作</button>{/if}
	</header>

	{#if !segment}
		<p class="muted">先加一段才能加動作。</p>
	{:else}
		<p class="seg">段 <b>{segmentLabel}</b> <span class="muted">（動作不能跨段）</span></p>
		<label>
			大類
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
		<label>名稱 <input bind:value={draft.name} onchange={changed} placeholder="例如：Lib、籃拋" /></label>
		<label>
			開始
			<input aria-label="開始" bind:value={draft.startText} onchange={changed} />
			<small class="muted">{segment.kind === 'music' ? '八拍-拍，例：3-5&' : '秒，到 0.1'}</small>
		</label>
		<label>
			長度
			<input aria-label="長度" bind:value={draft.lengthText} onchange={changed} />
			<small class="muted">{segment.kind === 'music' ? '拍（8 拍＝1 個八拍）' : '秒'}</small>
		</label>

		<div class="people">
			<div class="people-head">
				<span>人（{draft.members.length}）＋任務角色</span>
				<button type="button" class="link" onclick={() => (glossaryOpen = true)}>名詞對照表</button>
			</div>
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
							aria-label="把 {nameOf(m.memberId)} 移出這個動作"
							onclick={() => removeMember(i)}>✕</button
						>
					</li>
				{/each}
			</ul>
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

		<label>備註 <textarea rows="2" bind:value={draft.note} onchange={changed}></textarea></label>

		{#if !action}<button type="button" class="primary" onclick={add}>新增動作</button>{/if}
	{/if}

	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

{#if glossaryOpen}
	<RoleGlossary {flow} {onchange} onclose={() => (glossaryOpen = false)} />
{/if}

<style>
	.action-form {
		display: grid;
		gap: 6px;
		font-size: 13px;
		padding-bottom: 10px;
		margin-bottom: 10px;
		border-bottom: 1px solid #dde1ea;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h3 {
		margin: 0;
		font-size: 14px;
	}
	p {
		margin: 0;
	}
	label {
		display: grid;
		grid-template-columns: 3em minmax(0, 1fr);
		gap: 2px 6px;
		align-items: center;
	}
	label small {
		grid-column: 2;
	}
	.muted {
		color: #7a8296;
	}
	.people {
		border: 1px solid #e3e6ee;
		border-radius: 6px;
		padding: 6px;
		display: grid;
		gap: 4px;
	}
	.people-head {
		display: flex;
		justify-content: space-between;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 4px;
		align-items: center;
	}
	.link {
		border: none;
		background: none;
		color: #2f5bd3;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
	}
	.danger {
		color: #c0392b;
	}
	.error {
		color: #c0392b;
	}
</style>
