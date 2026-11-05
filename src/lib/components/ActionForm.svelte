<script lang="ts">
	// 動作表單：沒選動作時是新增（卡片標「新動作」、換底色，開始跟著播放頭；「新增動作」黏在右邊欄底部，名稱、開始、長度欄按 Enter 也新增）；
	// 選了動作時改那個動作，改了馬上生效。換大類後有人不是新大類的預設任務角色，提示可以一次換掉。
	// 卡片的標題就是名稱輸入框；辨識色沒挑就用大類的顏色。
	// 規則（跨段、重疊、至少 1 人、角色存在）都交給流程核心判斷；被擋就顯示原因並還原。
	// 會切短或拿掉拍點時，核心回「要確認」：顯示清單，按確定才改，按取消就還原。
	// 會清掉紀錄時也一樣先問；有紀錄的組換了人，核心回「要選」：保留舊紀錄、清掉重算、取消。
	// 新增時，人就是選到的人（加人、移出也改選取）；「從別的動作複製人」連任務角色和組一起帶。
	// 同一時間在別的動作裡的人標出來（「拿掉這幾個人」一次拿掉）；改動作時選了別的人，「把選的 N 人加進來」。
	// 從任務角色選單的「＋自訂任務角色…」新增的角色，套給打開選單的那個人。
	// 加進來的人先照大類和全局角色填任務角色（核心的 defaultRoles）；新增時換大類，沒改過的跟著換。
	// 改動作時「開始」旁邊有「跳到開始」（播放頭跳到動作開始）。
	// 改動作時有「接下一個動作」（開新表單接在結束拍，人、任務角色、組帶過去），下面是拍點格子（環節也在那裡加）；動作有環節時（騰翻、跳躍除外）每個人旁邊寫第幾組（唯讀；分組在場上的分組浮動列），勾「照組排」就照組號排。
	// 表單上的草稿和它的規則（跟著選的人、播放頭、自訂任務角色，送出、紅字）在編輯器 module 的 actionDraft；這裡只畫它、接上欄位和按鈕。
	import { flushSync, tick, type ComponentProps } from 'svelte';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { composing } from '#lib/ime.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import {
		ACTION_CATEGORIES,
		actionHints,
		actionLabel,
		actionSeconds,
		groupsPeople,
		memberName,
		positionText,
		roleGlossary,
		segmentSpans,
		squadBadge,
		type ActionCategory
	} from '#lib/core';
	import { ACTION_COLORS, actionColor, CATEGORY_COLORS } from './category-colors';
	import CharCount from './CharCount.svelte';
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

	// 流程從 session 拿；表單上的草稿（選到的動作，或跟著選的人、播放頭的新動作）在編輯器 module。
	const session = getEditorSession();
	const editor = getEditor();
	const draft = editor.actionDraft;
	let nameInput = $state<HTMLInputElement>();
	let noteInput = $state<HTMLTextAreaElement>();
	const flow = $derived(session.flow!);
	/** 選到的動作；null = 新增。 */
	const action = $derived(draft.action);
	const segment = $derived(draft.segment);
	const segmentLabel = $derived(
		segmentSpans(flow).find((s) => s.segment.id === segment?.id)?.label ?? ''
	);
	const roles = $derived(roleGlossary(flow));
	const categoryLabel = $derived(ACTION_CATEGORIES.find((c) => c.key === draft.category)?.label ?? '');
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

	/** 同一時間在別的動作裡的人：隊員 id → 那個動作（清單和「＋加人…」標出來）。 */
	const busy = $derived(draft.busy);
	const busyHere = $derived(draft.members.filter((m) => busy.has(m.memberId)));
	/** 改動作時，選了但還沒在動作裡的人（「把選的 N 人加進來」）。 */
	const pickedOutside = $derived(
		action
			? session.selectedMemberIds.filter(
					(id) => flow.members.some((m) => m.id === id) && !draft.members.some((d) => d.memberId === id)
				)
			: []
	);

	/** 動作有環節、要分組（騰翻跳躍以外）：每個人旁邊寫第幾組（唯讀，分組在場上的分組浮動列）。 */
	const grouped = $derived(!!action && groupsPeople(action));
	/** 人員清單照組號排（沒分組的排最後）；只在分組的動作有用。 */
	let bySquad = $state(false);
	/** 清單上的順序：draft.members 的第幾個。 */
	const order = $derived.by(() => {
		const all = draft.members.map((_, i) => i);
		if (!grouped || !bySquad || !action) return all;
		const num = (i: number) => squadBadge(action, draft.members[i]).number || Infinity;
		return all.toSorted((a, b) => num(a) - num(b));
	});

	/** 被擋的原因，和等教練回答的改動（草稿的；換了動作就收掉）。 */
	const ask = draft.ask;
	let glossaryOpen = $state(false);
	/** 從第幾個人的任務角色選單打開名詞對照表（「＋自訂任務角色…」）：新增的角色套給他。 */
	let roleFor: number | null = null;
	let formEl: HTMLElement;
	/** 「?」說明點了才開（Tab 到它、滑鼠移過去都不開，才不會自己彈出來蓋住東西）。 */
	let legendOpen = $state(false);
	let bangEl = $state<HTMLElement>();

	function closeLegend() {
		legendOpen = false;
	}

	/** 問句是改長度問的：畫在長度欄位旁邊。 */
	let askAtLength = $state(false);

	function lengthChanged() {
		changed();
		askAtLength = !!ask.question;
	}

	/** 改了表單：改選到的動作就馬上送出（草稿的 update）；新增時什麼都不做（等按「新增動作」）。 */
	function changed() {
		askAtLength = false;
		draft.update();
	}

	/** 新動作的名稱、開始、長度欄按 Enter 就新增（選字中的 Enter 不算）。 */
	function addOnEnter(e: KeyboardEvent) {
		if (action || e.key !== 'Enter' || composing(e) || !draft.members.length) return;
		e.preventDefault();
		draft.add();
	}

	function remove() {
		askAtLength = false;
		if (action) session.removeAction(action.id, ask);
		keepFocus();
	}

	/** 按的鈕做完就不見了（刪除動作、新增動作、接下一個動作）：焦點給表單的名稱，不掉回頁面最上面。 */
	async function keepFocus() {
		await tick();
		if (!formEl.contains(document.activeElement)) nameInput?.focus();
	}

	/** 選了任務角色；按快捷鍵選的就跳到下一個人。 */
	function setRole(i: number, role: string | null, byKey: boolean) {
		draft.setRole(i, role);
		changed();
		if (byKey) rolePickers[order[order.indexOf(i) + 1]]?.focus();
	}

	/** 名詞對照表新增了自訂任務角色：是從任務角色選單打開的，就套給那個人。 */
	function roleAdded(name: string) {
		if (roleFor === null || !draft.members[roleFor]) return;
		setRole(roleFor, name, false);
		roleFor = null;
	}

	function openGlossary(i: number | null) {
		roleFor = i;
		glossaryOpen = true;
	}

	function addSelected() {
		draft.addMembers(pickedOutside);
		changed();
	}

	function dropBusy() {
		draft.dropBusy();
		changed();
	}

	function addMember(select: HTMLSelectElement) {
		if (!select.value) return;
		draft.addMember(select.value);
		select.value = '';
		changed();
	}

	/** 移出一個人。焦點留在表單裡（下一個人的 ×，沒人了就「加人」），不掉到頁面上：不然接著按 Backspace 會刪掉整個動作。 */
	function removeMember(i: number) {
		draft.removeMember(i);
		changed();
		flushSync();
		const xs = formEl.querySelectorAll<HTMLElement>('button[aria-label$="移出這個動作"]');
		(xs[i] ?? xs[i - 1] ?? formEl.querySelector<HTMLElement>('select[aria-label="加人"]'))?.focus();
	}

	/**
	 * 表單裡的按鍵不給頁面：新增時 Esc 不清選取；Delete／Backspace 不刪整個動作（拍點格子自己清拍點，
	 * 輸入框照常刪字）。要刪動作用「刪除動作」，或在泳道選了按 Delete。
	 */
	function formKey(e: KeyboardEvent) {
		if ((!action && e.key === 'Escape') || e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
	}

	/** 把別的動作的人連任務角色一起換進來。 */
	function copyFrom(select: HTMLSelectElement) {
		const source = flow.actions.find((a) => a.id === select.value);
		select.value = '';
		if (!source) return;
		draft.copyMembers(source);
		changed();
	}

	function setCategory(category: ActionCategory) {
		draft.setCategory(category);
		changed();
	}

	function useDefaultRoles() {
		draft.useDefaultRoles();
		changed();
	}

	function setColor(color: string | undefined) {
		draft.setColor(color);
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
<!-- 新動作的字還不在流程裡：⌘Z 交給瀏覽器退字（data-native-undo）。 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	class="action-form"
	class:creating={!action}
	data-native-undo={!action || undefined}
	style:--cat={actionColor(draft)}
	bind:this={formEl}
	onkeydown={formKey}
>
	<header>
		<span class="dot"></span>
		<input
			class="title"
			aria-label="名稱"
			bind:value={draft.name}
			bind:this={nameInput}
			onchange={changed}
			onkeydown={addOnEnter}
			placeholder={action ? '幫這個動作取名字' : '新動作的名稱，例如：Lib、籃拋'}
		/>
		<CharCount field="actionName" input={nameInput} value={draft.name} />
		{#if !action}<span class="badge">新動作</span>{/if}
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
			{#if draft.offerDefaultRoles}
				<p class="wide roles-offer" role="note">
					有人的任務角色不是{categoryLabel}的預設值
					<button type="button" class="link" onclick={useDefaultRoles}>換成{categoryLabel}的預設任務角色</button>
				</p>
			{/if}
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
				<span class="start-cap">
					<span class="cap" aria-hidden="true">開始</span>
					{#if action}
						<button type="button" class="link" onclick={() => editor.seekToAction(action.id)}>跳到開始</button>
					{/if}
				</span>
				<input
						aria-label="開始"
						bind:value={draft.startText}
						onchange={changed}
						onkeydown={addOnEnter}
						onfocus={() => draft.focusSlotField('startText')}
						onblur={() => draft.focusSlotField(null)}
					/>
				<small>{segment.kind === 'music' ? '八拍-拍，例：3-5&' : '秒，到 0.1'}</small>
			</div>
			<div class="field">
				<span class="cap" aria-hidden="true">長度</span>
				<input
						aria-label="長度"
						bind:value={draft.lengthText}
						onchange={lengthChanged}
						onkeydown={addOnEnter}
						onfocus={() => draft.focusSlotField('lengthText')}
						onblur={() => draft.focusSlotField(null)}
					/>
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
				<span class="cap">人（{draft.members.length}）・任務角色</span>
				<span class="legend">
					<button
						type="button"
						class="ghost bang"
						aria-label="顏色和快捷鍵說明"
						aria-describedby="people-legend"
						aria-expanded={legendOpen}
						bind:this={bangEl}
						onclick={() => (legendOpen = !legendOpen)}>?</button
					>
					<!-- 說明放在「?」下面、右邊對齊；點外面（點「?」自己是開關）、按 Esc 就收（popover.svelte.ts） -->
					<span
						class="tip"
						id="people-legend"
						role="tooltip"
						hidden={!legendOpen}
						{@attach legendOpen &&
							popover({ place: below(bangEl!, { gap: 6, align: 'right', flip: true }), close: closeLegend, inside: [bangEl] })}
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
				{#if grouped}
					<label class="by-squad"><input type="checkbox" bind:checked={bySquad} />照組排</label>
				{/if}
				<button type="button" class="link" onclick={() => openGlossary(null)}>名詞對照表</button>
			</div>
			{#if draft.members.length}
				<ul class:grouped>
					{#each order.map((i) => ({ m: draft.members[i], i })) as { m, i } (m.memberId)}
						{@const who = memberOf(m.memberId)}
						<li>
							<span class="who">
								{#if who}<i class="gr {who.globalRole}">{who.globalRole === 'top' ? '上' : '底'}</i>{/if}
								<span class="name {who?.gender ?? ''}">{nameOf(m.memberId)}</span>
								{#if busy.get(m.memberId)}<span class="busy-tag">在「{actionLabel(busy.get(m.memberId)!)}」裡</span>{/if}
							</span>
							<RolePicker
								bind:this={rolePickers[i]}
								label="{nameOf(m.memberId)} 的任務角色"
								value={m.role}
								{roles}
								onpick={(role, byKey) => setRole(i, role, byKey)}
								onnew={() => openGlossary(i)}
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
			{#if busyHere.length}
				<p class="hint-warn" role="note">
					{busyHere.map((m) => nameOf(m.memberId)).join('、')} 同一時間在別的動作裡
					<button type="button" class="link" onclick={dropBusy}>拿掉這幾個人</button>
				</p>
			{/if}
			{#each actionHints(draft) as hint (hint)}<p class="hint-warn" role="note">{hint}</p>{/each}
			{#if pickedOutside.length}
				<button type="button" class="add-picked" onclick={addSelected}
					><Icon name="plus" size={14} />把選的 {pickedOutside.length} 人加進來</button
				>
			{/if}
			<div class="adders">
				<select aria-label="加人" onchange={(e) => addMember(e.currentTarget)}>
					<option value="">＋加人…</option>
					{#each others as m (m.id)}
						{@const a = busy.get(m.id)}
						<option value={m.id}>{m.name}{a ? `（在「${actionLabel(a)}」裡）` : ''}</option>
					{/each}
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
			<span class="cap note-cap">備註<CharCount field="note" input={noteInput} value={draft.note} /></span>
			<textarea aria-label="備註" rows="2" bind:value={draft.note} bind:this={noteInput} onchange={changed}></textarea>
		</label>

		{#if action}
			<!-- 轉接（例如 Lib 轉金字塔）：開新表單接在結束拍後面，人、任務角色、組帶過去 -->
			<button type="button" class="next" onclick={() => (draft.next(), keepFocus())}><Icon name="plus" size={14} />接下一個動作</button>
			<CueGrid {action} {cellAt} />
		{:else}
			<!-- 黏在右邊欄底部：表單很長時不用捲到最下面才按得到 -->
			<div class="add-bar">
				<button
					type="button"
					class="primary add"
					disabled={!draft.members.length}
					aria-describedby={draft.members.length ? undefined : 'add-why'}
					onclick={() => (draft.add(), keepFocus())}>新增動作</button
				>
				{#if !draft.members.length}<p class="muted why" id="add-why">還沒有人：先選人才能新增</p>{/if}
			</div>
		{/if}
	{/if}

	<!-- 「刪除動作」畫在標題右邊，但在 Tab 順序的最後：在名稱按 Tab 不會先跳到它。 -->
	{#if action}
		<button type="button" class="danger remove" onclick={remove}><Icon name="trash" size={14} />刪除動作</button>
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
	<RoleGlossary onclose={() => (glossaryOpen = false)} onadded={roleAdded} />
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
		grid-area: 1 / 1;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* 「刪除動作」跟標題同一格、靠右；標題留出它的位置。 */
	.action-form:has(> .remove) header {
		padding-right: 96px;
	}
	.remove {
		grid-area: 1 / 1;
		justify-self: end;
		align-self: center;
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
	.next {
		justify-self: start;
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
	.note-cap,
	.start-cap {
		display: flex;
		justify-content: space-between;
	}
	.start-cap .link {
		font-size: 12px;
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
	.by-squad {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-right: 8px;
		font-size: 12px;
		color: var(--muted, #66718a);
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
	/* 手指：「?」點得到的範圍 32px，看起來不變。 */
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
	.busy-tag {
		font-size: 11px;
		color: var(--danger, #c8372d);
		white-space: nowrap;
	}
	.add-picked {
		justify-self: start;
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
	.add-bar {
		position: sticky;
		bottom: 0;
		z-index: 1;
		display: grid;
		gap: 6px;
		margin: 0 -14px;
		padding: 10px 14px;
		background: var(--new-bg);
		box-shadow: 0 -6px 8px -6px rgb(0 0 0 / 0.15);
	}
	.add {
		width: 100%;
		padding: 8px 12px;
		font-size: 14px;
	}
	.why {
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
	.roles-offer {
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.error {
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
