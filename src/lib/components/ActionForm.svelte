<script lang="ts">
	// 動作表單：沒選動作時是新增（卡片標「新動作」、換底色，開始跟著播放頭）；選了動作時改那個動作，改了馬上生效。
	// 卡片的標題就是名稱輸入框；辨識色沒挑就用大類的顏色。
	// 規則（跨段、重疊、至少 1 人、角色存在）都交給流程核心判斷；被擋就顯示原因並還原。
	// 會切短或拿掉拍點時，核心回「要確認」：顯示清單，按確定才改，按取消就還原。
	// 會清掉紀錄時也一樣先問；有紀錄的組換了人，核心回「要選」：保留舊紀錄、清掉重算、取消。
	// 新增時，人就是選到的人（加人、移出也改選取）；「從別的動作複製人」連任務角色和組一起帶。
	// 加進來的人先照大類和全局角色填任務角色（核心的 defaultRoles）；新增時換大類，沒改過的跟著換。
	// 改動作時下面是拍點格子（環節也在那裡加）；動作有環節時（騰翻、跳躍除外）每個人旁邊寫第幾組（唯讀；分組在場上的分組浮動列）。
	import { untrack, type ComponentProps } from 'svelte';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import {
		ACTION_CATEGORIES,
		actionHints,
		actionLabel,
		actionSeconds,
		actionSlotAt,
		addAction,
		atText,
		defaultRoles,
		deleteAction,
		groupsPeople,
		lengthText,
		memberName,
		positionText,
		readLength,
		readStart,
		roleGlossary,
		segmentSpans,
		squadBadge,
		updateAction,
		type Action,
		type ActionCategory,
		type ActionMember,
		type ConfirmOption,
		type NewActionInput,
		type ReadResult
	} from '#lib/core';
	import { ACTION_COLORS, actionColor, CATEGORY_COLORS } from './category-colors';
	import ConfirmList from './ConfirmList.svelte';
	import CueGrid from './CueGrid.svelte';
	import { reveal } from './reveal';
	import Icon from './Icon.svelte';
	import RoleGlossary from './RoleGlossary.svelte';
	import RolePicker, { roleKey } from './RolePicker.svelte';

	interface Props {
		/** 拍點格子的「指標位置 → 格子」；沒給用格子預設的（ADR 0002）。 */
		cellAt?: ComponentProps<typeof CueGrid>['cellAt'];
	}

	let { cellAt }: Props = $props();

	// 流程、選到的動作（null = 新增）、選到的人（新增時就是新動作的人）都從 session 拿。
	const session = getEditorSession();
	const flow = $derived(session.flow!);
	const actionId = $derived(session.selectedActionId);
	const selectedMemberIds = $derived(session.selectedMemberIds);
	/** 播放頭從編輯器 module 的播放拿：新動作從這裡開始。 */
	const { playback } = getEditor();

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
	const slot = $derived(action ? null : actionSlotAt(flow, playback.sec));
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

	/** 動作有環節、要分組（騰翻跳躍以外）：每個人旁邊寫第幾組（唯讀，分組在場上的分組浮動列）。 */
	const grouped = $derived(!!action && groupsPeople(action));

	let draft = $state<Draft>(blank());
	/** 被擋的原因，和等教練回答的改動（會切短或拿掉拍點、會清掉紀錄；有紀錄的組換了人要選保留／清掉）。 */
	const ask = session.changeAsk();
	let glossaryOpen = $state(false);
	/** 「!」說明點一下打開（iPad 沒有滑鼠移上去）。 */
	let legendOpen = $state(false);
	/** 滑鼠移到「!」上、或用鍵盤移到「!」：也看得到說明，移開就收。 */
	let legendPeek = $state(false);
	const legendShown = $derived(legendOpen || legendPeek);
	let bangEl = $state<HTMLElement>();

	function closeLegend() {
		legendOpen = false;
		legendPeek = false;
	}

	function blank(): Draft {
		const members = untrack(() => fromSelection([], 'stunt'));
		return { category: 'stunt', name: '', startText: '', lengthText: '', note: '', members, color: undefined };
	}

	/** 選到的人當新動作的人；已經在表單裡的人保留任務角色，新來的照大類先填。 */
	function fromSelection(current: ActionMember[], category: ActionCategory): ActionMember[] {
		return selectedMemberIds
			.filter((id) => flow.members.some((m) => m.id === id))
			.map((id) => current.find((m) => m.memberId === id) ?? joined(id, category));
	}

	/** 剛加進動作的人：任務角色照大類和全局角色先填。 */
	function joined(memberId: string, category: ActionCategory): ActionMember {
		return defaultRoles(flow, category, [{ memberId, role: null }])[0];
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

	// 新增時改了表單（人、開始、長度…，也包括跟著選取、播放頭改的）就告訴 Ask，收掉上次被擋的原因：
	// 可能已經不對了，按新增會再檢查一次。改動作時不說：改了馬上生效，原因是那一下被擋、已還原的說明。
	// 草稿還在這裡、很多地方會改它，所以先用 $effect 看它有沒有變；草稿搬進編輯器 module（#126）後由它告訴 Ask。
	$effect(() => {
		if (action) return;
		JSON.stringify(draft);
		untrack(() => ask.edited());
	});

	// 新增到一半在名詞對照表改名、刪掉自訂角色：表單裡的人跟著換名字，刪掉的變成沒有任務。
	// （改動作時表單照動作重設，動作裡的人核心已經改好了。）
	let customNames = untrack(() => new Map(flow.customRoles.map((r) => [r.id, r.name])));
	$effect(() => {
		const now = new Map(flow.customRoles.map((r) => [r.id, r.name]));
		untrack(() => {
			const changed = new Map<string, string | null>();
			for (const [id, name] of customNames) if (now.get(id) !== name) changed.set(name, now.get(id) ?? null);
			customNames = now;
			if (action || !changed.size) return;
			draft.members = draft.members.map((m) =>
				m.role !== null && changed.has(m.role) ? { ...m, role: changed.get(m.role)! } : m
			);
		});
	});

	// 換選到的動作（或回到新增）時重設表單。
	$effect(() => {
		const a = action;
		untrack(() => {
			draft = a ? fromAction(a) : blank();
			ask.clear();
		});
	});

	// 新增時，人跟著選取。
	$effect(() => {
		void selectedMemberIds;
		if (action) return;
		untrack(() => (draft.members = fromSelection(draft.members, draft.category)));
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

	/** 表單讀成動作：開始、長度由核心讀，看不懂就是被擋（原因交給問教練）。 */
	function toInput(): ReadResult<NewActionInput> {
		// 沒有段時沒有「新增動作」鈕；選到的動作一定在某一段裡。
		const seg = segment!;
		const start = readStart(seg, draft.startText);
		if (start.kind === 'blocked') return start;
		const length = readLength(seg, draft.lengthText);
		if (length.kind === 'blocked') return length;
		const { category, name, note, members, color } = draft;
		const value = { segmentId: seg.id, category, name, start: start.value, length: length.value, note, members, color };
		return { kind: 'ok', value };
	}

	function add() {
		const input = toInput();
		ask.send(() => (input.kind === 'blocked' ? input : addAction(flow, input.value)), {
			done: (r) => session.selectAction(r.id)
		});
	}

	/** 問句是改長度問的：畫在長度欄位旁邊。 */
	let askAtLength = $state(false);

	function lengthChanged() {
		changed();
		askAtLength = !!ask.question;
	}

	/** 改選到的動作：馬上送給流程核心；被擋（或問了按取消）就還原。新增時什麼都不做（等按「新增動作」）。 */
	function changed() {
		askAtLength = false;
		if (!action) return;
		const id = action.id;
		const input = toInput();
		ask.send(
			(o: ConfirmOption = {}) => (input.kind === 'blocked' ? input : updateAction(flow, id, input.value, o)),
			{ revert: () => action && (draft = fromAction(action)) }
		);
	}

	function remove() {
		askAtLength = false;
		if (!action) return;
		const id = action.id;
		ask.send((o: ConfirmOption = {}) => deleteAction(flow, id, o), { done: () => session.selectAction(null) });
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
		else session.selectMembers(draft.members.map((m) => m.memberId));
	}

	function addMember(select: HTMLSelectElement) {
		if (!select.value) return;
		draft.members.push(joined(select.value, draft.category));
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

	/** 換大類；新增時任務角色還是舊大類預設值的人跟著換。 */
	function setCategory(category: ActionCategory) {
		if (!action) draft.members = defaultRoles(flow, category, draft.members, draft.category);
		draft.category = category;
		changed();
	}

	function setColor(color: string | undefined) {
		draft.color = color;
		changed();
	}

	const nameOf = (id: string) => memberName(flow, id);
	const memberOf = (id: string) => flow.members.find((m) => m.id === id);
</script>

<!-- 放在卡片外面：放裡面會看成是對這個動作做事 -->
{#if action}
	<button type="button" class="new" onclick={() => session.selectAction(null)}><Icon name="plus" size={14} />開新的動作表單</button>
{/if}

<!-- 新動作表單裡按 Esc 不往上傳：編輯頁的 Esc 會取消選人，連帶清掉表單裡選好的人和任務角色。 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	class="action-form"
	class:creating={!action}
	style:--cat={actionColor(draft)}
	onkeydown={(e) => !action && e.key === 'Escape' && e.stopPropagation()}
>
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
					onchange={(e) => setCategory(e.currentTarget.value as ActionCategory)}
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
				<input aria-label="長度" bind:value={draft.lengthText} onchange={lengthChanged} />
				<small>{segment.kind === 'music' ? '拍（8 拍＝1 個八拍）' : '秒'}</small>
			</div>
			<!-- 改長度要確認（會切到拍點）：問句就在長度下面，不用捲到表單最底下找。 -->
			{#if askAtLength && ask.question}
				<div class="wide" {@attach reveal(ask.failures)}>
					<ConfirmList {ask} />
				</div>
			{/if}
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
						bind:this={bangEl}
						onclick={() => (legendOpen = !legendOpen)}
						onpointerenter={(e) => e.pointerType === 'mouse' && (legendPeek = true)}
						onpointerleave={() => (legendPeek = false)}
						onfocus={(e) => e.currentTarget.matches(':focus-visible') && (legendPeek = true)}
						onfocusout={closeLegend}>!</button
					>
					<!-- 說明放在「!」下面、右邊對齊；點外面（點「!」自己是開關）、按 Esc 就收（popover.svelte.ts） -->
					<span
						class="tip"
						id="people-legend"
						role="tooltip"
						hidden={!legendShown}
						{@attach legendShown &&
							popover({ place: below(bangEl!, { gap: 6, align: 'right' }), close: closeLegend, inside: [bangEl] })}
					>
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
				<ul class:grouped>
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
								{roles}
								onpick={(role, byKey) => setRole(i, role, byKey)}
								onnew={() => (glossaryOpen = true)}
							/>
							{#if grouped}
								{@const badge = action && squadBadge(action, m)}
								{#if badge?.number}<span class="squad-tag" style:--c={badge.color}>第 {badge.number} 組</span>
								{:else}<span class="squad-tag none">沒分組</span>{/if}
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
			{#each actionHints(draft) as hint (hint)}<p class="hint-warn" role="note">{hint}</p>{/each}
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
			<CueGrid {action} {cellAt} />
		{:else}
			<button
				type="button"
				class="primary add"
				disabled={!draft.members.length}
				aria-describedby={draft.members.length ? undefined : 'add-why'}
				onclick={add}>新增動作</button
			>
			{#if !draft.members.length}<p class="muted why" id="add-why">還沒有人：先選人才能新增</p>{/if}
		{/if}
	{/if}

	<!-- 問句在拍點格子下面，常在看得到的範圍外：出現時捲過去。 -->
	{#if ask.question && !askAtLength}
		<div {@attach reveal(ask.failures)}>
			<ConfirmList {ask} />
		</div>
	{/if}

	<!-- 右邊欄很長時原因會在看得到的範圍下面，按了像沒反應：出現時捲過去。 -->
	{#if ask.error}<p class="error" role="alert" {@attach reveal(ask.failures)}>{ask.error}</p>{/if}
</section>

{#if glossaryOpen}
	<RoleGlossary onclose={() => (glossaryOpen = false)} />
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
	/* 手指：色票、「照大類」至少 32px */
	@media (pointer: coarse) {
		.swatch {
			width: 32px;
			height: 32px;
		}
		.swatch.auto {
			width: auto;
		}
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
	/* 手指：「!」點得到的範圍 32px，看起來不變。 */
	@media (pointer: coarse) {
		.bang {
			position: relative;
		}
		.bang::after {
			content: '';
			position: absolute;
			inset: -7px;
		}
	}
	.tip {
		display: grid;
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、框線、捲軸、顏色 */
		position: fixed;
		inset: auto;
		margin: 0;
		border: 0;
		overflow: visible;
		color: inherit;
		width: max-content;
		max-width: min(320px, 80vw);
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--surface, #fff);
		box-shadow: var(--shadow-pop);
		font-size: 12px;
		gap: 6px;
	}
	.tip[hidden] {
		display: none;
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
	/* 動作有環節時：任務角色和移出鈕中間多一個唯讀的「第 n 組」標籤 */
	ul.grouped li {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto auto;
	}
	.squad-tag {
		font-size: 12px;
		font-weight: 700;
		color: #fff;
		background: var(--c);
		border-radius: 999px;
		padding: 1px 8px;
		white-space: nowrap;
	}
	.squad-tag.none {
		color: var(--muted, #66718a);
		background: none;
		font-weight: 400;
		padding-inline: 0;
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
	.why {
		margin-top: -6px;
		font-size: 12px;
		text-align: center;
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
