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
	// 清單上 Shift＋點名字（iPad 開著「多選」點）選好幾個人，在其中一人選任務角色就一起設（算一步復原）；怎麼多選常駐寫一行。
	// 改動作時，清單上點名字就是選人（session 的選取，場上跟著亮；場上選的人清單也框起來）。
	// 新增時人就是選到的人，點名字不能改選取（人會跟著縮），只在表單裡框起來。
	// 加進來的人先照大類和全局角色填任務角色（核心的 defaultRoles）；新增時換大類，沒改過的跟著換。
	// 改動作時「開始」旁邊有「跳到開始」（播放頭跳到動作開始）。
	// 改動作時有「接下一個動作」（開新表單接在結束拍，人、任務角色、組帶過去），下面是拍點格子（環節也在那裡加）；動作有環節時（騰翻、跳躍除外）每個人旁邊寫第幾組（唯讀；分組在場上的分組浮動列），勾「照組排」就照組號排。
	// 表單上的草稿和它的規則（跟著選的人、播放頭、自訂任務角色，送出、紅字）在編輯器 module 的 actionDraft；這裡只畫它、接上欄位和按鈕。
	import { flushSync, tick, type ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';
	import { getEditor } from '#lib/editor.svelte.js';
	import { roleText, whyText, joinText } from '#lib/reason-text.js';
	// 改名 msg：這個檔的 m 是一個人（draft.members 的一個）
	import { m as msg } from '#lib/paraglide/messages.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { isTouchScreen } from '#lib/editor-layout.js';
	import { composing } from '#lib/ime.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import {
		ACTION_CATEGORIES,
		actionHints,
		actionSeconds,
		actionWhy,
		categoryWhy,
		groupsPeople,
		labelWhy,
		memberName,
		positionWhy,
		pickableRoles,
		roleGlossary,
		segmentSpans,
		squadBadge,
		timeExamples,
		type ActionCategory
	} from '#lib/core';
	import { ACTION_COLORS, actionColor, CATEGORY_COLORS } from './category-colors';
	import CharCount from './CharCount.svelte';
	import ConfirmList from './ConfirmList.svelte';
	import CueGrid from './CueGrid.svelte';
	import { reveal, revealAlert, stickyBottom } from './reveal';
	import Icon from './Icon.svelte';
	import RoleGlossary from './RoleGlossary.svelte';
	import RolePicker from './RolePicker.svelte';

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
	const segmentSpan = $derived(segmentSpans(flow).find((s) => s.segment.id === segment?.id));
	const segmentLabel = $derived(segmentSpan ? whyText(labelWhy(segmentSpan)) : '');
	/** 「在 音樂 1 裡」切成段名前、段名後：段名粗體，句子照語言寫。 */
	const inSegment = msg.action_form_in_segment({ segment: '\0' }).split('\0');
	/** 選單的任務角色：三層、肩底只有金字塔有。快捷鍵的說明照這個列。 */
	const roles = $derived(pickableRoles(flow, draft.category, []));
	/** 這個人的選單：已經是三層（肩底）的人換了大類，他自己的選單照列，別人的沒有。 */
	const rolesFor = (role: string | null) => pickableRoles(flow, draft.category, [role]);
	const categoryLabel = $derived(whyText(categoryWhy(draft.category)));
	/** 動作、任務角色的名字照畫面的語言寫：內建的（大類、固定任務角色）翻，教練取的照原樣。 */
	const actionText = (a: Parameters<typeof actionWhy>[0]) => whyText(actionWhy(a));
	/** 一串名字：「小A、小B」。 */
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
				label: (a.members.length === 1 ? msg.action_form_copy_source_one : msg.action_form_copy_source)({
					at: whyText(positionWhy(flow, sec)),
					action: actionText(a),
					n: a.members.length
				})
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

	/** 動作有環節、要分組（騰翻跳躍以外）：一組一張卡片（唯讀，分組在場上的分組浮動列）。 */
	const grouped = $derived(!!action && groupsPeople(action));
	/** 任務角色排第幾（名詞對照表的順序），沒有任務排最後。 */
	const roleRank = $derived(new Map(roleGlossary(flow).map((r, k) => [r.name, k])));
	/**
	 * 清單分成卡片：分組的動作一組一張（照組號，沒分組的最後一張）；不分組就一張沒有標題的。
	 * 卡片裡照任務角色排，一樣的照加進來的順序。rows 是 draft.members 的第幾個。
	 */
	const cards = $derived.by(() => {
		const rank = (i: number) => roleRank.get(draft.members[i].role ?? '') ?? Infinity;
		const rows = draft.members.map((_, i) => i).toSorted((a, b) => rank(a) - rank(b));
		if (!grouped || !action) return [{ head: '', color: '', rows }];
		const byNumber = new Map<number, { head: string; color: string; rows: number[] }>();
		for (const i of rows) {
			const b = squadBadge(action, draft.members[i]);
			const card = byNumber.get(b.number) ?? {
				head: b.number ? msg.success_rate_squad({ n: b.number }) : msg.action_form_no_squad(),
				color: b.number ? b.color : '',
				rows: []
			};
			card.rows.push(i);
			byNumber.set(b.number, card);
		}
		return [...byNumber].toSorted(([a], [b]) => (a || Infinity) - (b || Infinity)).map(([, card]) => card);
	});
	/** 清單上的順序（卡片接起來）：按快捷鍵選好後跳到下一個人用。 */
	const order = $derived(cards.flatMap((c) => c.rows));

	/**
	 * 新動作表單沒選人時收起來，只有「＋ 新動作」（選了人就打開）。
	 * 按「＋ 新動作」、從選到的動作按「開新的動作表單」：沒選人也打開；換了選到的動作就回到收起來。
	 */
	let opened = $state(false);
	$effect.pre(() => {
		if (action) opened = false;
	});
	const open = $derived(!!action || opened || draft.members.length > 0);
	let expandEl = $state<HTMLButtonElement>();

	/** 「開新的動作表單」：回到新增，表單打開。 */
	function openNew() {
		session.selectAction(null);
		opened = true;
	}

	/** 「＋ 新動作」：打開表單，名稱有焦點。 */
	async function expand() {
		opened = true;
		await tick();
		nameInput?.focus();
	}

	/** 被擋的原因，和等教練回答的改動（草稿的；換了動作就收掉）。 */
	const ask = draft.ask;
	let glossaryOpen = $state(false);
	/** 從第幾個人的任務角色選單打開名詞對照表（「＋自訂任務角色…」）：新增的角色套給他。 */
	let roleFor: number | null = null;
	let formEl = $state<HTMLElement>();
	/** 「?」說明點了才開（Tab 到它、滑鼠移過去都不開，才不會自己彈出來蓋住東西）。 */
	let legendOpen = $state(false);
	let bangEl = $state<HTMLElement>();

	function closeLegend() {
		legendOpen = false;
	}

	/** 問句是改長度問的：畫在長度欄位旁邊。 */
	let askAtLength = $state(false);

	function lengthChanged() {
		changed('length');
		askAtLength = !!ask.question;
	}

	/** 表單上的一格（或「新增動作」鈕）：被擋的原因寫在它旁邊。 */
	type Spot = 'name' | 'category' | 'color' | 'start' | 'length' | 'people' | 'note' | 'add';
	/** 被擋的原因寫在哪：教練剛改的那一格、按 Enter 的那一格、或「新增動作」鈕旁邊，右邊欄不用自己捲過去。null：表單最下面。 */
	let errorAt = $state<Spot | null>(null);

	/** 改了表單（at：改的是哪一格）：改選到的動作就馬上送出（草稿的 update）；新增時什麼都不做（等按「新增動作」）。 */
	function changed(at: Spot) {
		askAtLength = false;
		errorAt = at;
		draft.update();
	}

	/** 新動作的名稱、開始、長度欄按 Enter 就新增（選字中的 Enter 不算）。 */
	function addOnEnter(e: KeyboardEvent, at: Spot) {
		if (action || e.key !== 'Enter' || composing(e) || !draft.members.length) return;
		e.preventDefault();
		errorAt = at;
		draft.add();
	}

	function remove() {
		// 點「刪除動作」不搶焦點（例：觸控）時，名稱欄打的字先送出，跟離開欄位一樣；表單換成新動作時「未存」不卡住
		editor.adapters.pendingInput.flush();
		askAtLength = false;
		errorAt = null;
		if (action) session.removeAction(action.id, ask);
		keepFocus('form');
	}

	/**
	 * 按的鈕做完就不見了：焦點留在表單裡，不掉回頁面最上面。
	 * 新增動作、接下一個動作給名稱；「刪除動作」給表單本身（to = 'form'），不給新動作的名稱：
	 * 那裡的 ⌘Z 是退字，按了刪除馬上 ⌘Z 要讓動作回來。
	 */
	async function keepFocus(to: 'name' | 'form' = 'name') {
		await tick();
		// 沒選人、表單收起來了（例：刪掉動作）：給「＋ 新動作」
		if (!open) return expandEl?.focus();
		if (!formEl!.contains(document.activeElement)) (to === 'form' ? formEl : nameInput)?.focus();
	}

	/**
	 * 新動作表單上點名字選到的人（隊員 id）：新增時人就是場上選的人，點名字不能改選取，另外記在這裡。
	 * 改動作時用 session 的選取，場上跟著亮。選到 2 人以上時，在其中一人選任務角色就一起設。
	 */
	let rowPicked = $state<string[]>([]);
	const actionId = $derived(action?.id);
	$effect.pre(() => {
		void actionId;
		rowPicked = [];
	});
	/** 選到、而且還在清單裡的人。 */
	const together = $derived(
		(action ? session.selectedMemberIds : rowPicked).filter((id) => draft.members.some((d) => d.memberId === id))
	);
	/** 一起選到的人裡，有人的任務角色這個大類的選單沒有（不是金字塔的三層、肩底）：只留給本來就是的人。 */
	const keptOnly = $derived([
		...new Set(
			draft.members
				.filter((m) => m.role && together.includes(m.memberId) && !roles.some((r) => r.name === m.role))
				.map((m) => m.role!)
		)
	]);
	/** 觸控螢幕沒有 Shift，多選要開場地左邊的「多選」（docs/adr/0005-ipad-touch.md）。 */
	const touchScreen = isTouchScreen();

	/** 點名字：沒按 Shift 只選他（再點一次取消）；按 Shift（或開著「多選」，iPad 沒有 Shift）加進來或拿掉。 */
	function pickRow(id: string, shift: boolean) {
		if (action) {
			// 跟場上點人一樣：Shift 加減時場上選的其他人留著
			if (shift) session.pickMember(id, true);
			else session.selectMembers(together.length === 1 && together[0] === id ? [] : [id]);
			return;
		}
		if (shift) rowPicked = together.includes(id) ? together.filter((x) => x !== id) : [...together, id];
		else rowPicked = together.length === 1 && together[0] === id ? [] : [id];
	}

	/** 選了任務角色；按快捷鍵選的就跳到下一個人。他在一起選到的人裡：那幾個人一起設，算一步。 */
	function setRole(i: number, role: string | null, byKey: boolean) {
		const all = together.length > 1 && together.includes(draft.members[i].memberId);
		// 改了角色那一列會換位置：下一個人照改之前的順序找
		const next = order[order.indexOf(i) + 1];
		// 一起選到的別人：只換成他自己選單裡有的（不是金字塔時，肩底、三層只留給本來就是的人）
		const allowed = (m: (typeof draft.members)[number]) => role === null || rolesFor(m.role).some((r) => r.name === role);
		draft.members.forEach((m, k) => {
			if (k === i || (all && together.includes(m.memberId) && allowed(m))) draft.setRole(k, role);
		});
		changed('people');
		// 先把列換好位置再給焦點：換位置時被搬動的列會掉焦點，接著按 Backspace 會刪掉整個動作
		flushSync();
		if (byKey && !all && next !== undefined) rolePickers[next]?.focus();
		else if (document.activeElement === document.body) rolePickers[i]?.focus();
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
		changed('people');
	}

	function dropBusy() {
		draft.dropBusy();
		changed('people');
	}

	function addMember(select: HTMLSelectElement) {
		if (!select.value) return;
		draft.addMember(select.value);
		select.value = '';
		changed('people');
	}

	/** 移出一個人。焦點留在表單裡（下一個人的 ×，沒人了就「加人」），不掉到頁面上：不然接著按 Backspace 會刪掉整個動作。 */
	function removeMember(i: number) {
		// 畫面上排第幾（清單照任務角色排，不是 draft.members 的順序）
		const at = order.indexOf(i);
		draft.removeMember(i);
		changed('people');
		flushSync();
		// 新動作移出最後一個人，表單收起來了：給「＋ 新動作」
		if (!formEl) return expandEl?.focus();
		const xs = formEl.querySelectorAll<HTMLElement>('button[data-remove-member]');
		(xs[at] ?? xs[at - 1] ?? formEl.querySelector<HTMLElement>('select[data-add-member]'))?.focus();
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
		askAtLength = false;
		errorAt = 'people';
		draft.copyMembers(source);
	}

	function setCategory(select: HTMLSelectElement) {
		draft.setCategory(select.value as ActionCategory);
		changed('category');
		// 被擋下來時草稿退回原本的大類，值沒變畫面不會重畫：選單自己對回去
		select.value = draft.category;
	}

	function useDefaultRoles() {
		draft.useDefaultRoles();
		changed('people');
	}

	function setColor(color: string | undefined) {
		draft.setColor(color);
		changed('color');
	}

	const nameOf = (id: string) => memberName(flow, id);
	const memberOf = (id: string) => flow.members.find((m) => m.id === id);
</script>

<!-- 放在卡片外面：放裡面會看成是對這個動作做事 -->
{#if action}
	<button type="button" class="new" onclick={openNew}><Icon name="plus" size={14} />{msg.action_form_open_new()}</button>
{/if}

{#if !open}
	<!-- 還沒選人：新動作表單收成一個鈕，不佔右邊欄 -->
	<button type="button" class="new collapsed" bind:this={expandEl} onclick={expand}>{msg.action_form_expand()}</button>
	<p class="muted collapsed-hint">{msg.action_form_collapsed_hint()}</p>
{:else}

<!-- 被擋的原因寫在教練剛改的那一格（或按的鈕）旁邊：不用捲去找。在看得到的範圍外、或在黏底的「新增動作」後面，就捲出來（N03）。 -->
{#snippet errorAtSpot(at: Spot, wide = false)}
	{#if ask.error && errorAt === at}<p class="error" class:wide {@attach revealAlert(ask.failures)}>{ask.error}</p>{/if}
{/snippet}

<!-- 新動作表單裡按 Esc 不往上傳：編輯頁的 Esc 會取消選人，連帶清掉表單裡選好的人和任務角色。 -->
<!-- 新動作的字還不在流程裡：⌘Z 交給瀏覽器退字（data-native-undo）。 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	class="action-form"
	class:creating={!action}
	data-native-undo={!action || undefined}
	style:--cat={actionColor(draft)}
	bind:this={formEl}
	tabindex="-1"
	onkeydown={formKey}
>
	<header>
		<span class="dot"></span>
		<input
			class="title"
			aria-label={msg.action_form_name()}
			bind:value={draft.name}
			bind:this={nameInput}
			onchange={() => changed('name')}
			onkeydown={(e) => addOnEnter(e, 'name')}
			placeholder={action ? msg.action_form_name_placeholder() : msg.action_form_new_name_placeholder()}
		/>
		<CharCount field="actionName" input={nameInput} value={draft.name} />
		{#if !action}<span class="badge">{msg.action_form_new_badge()}</span>{/if}
	</header>
	{@render errorAtSpot('name')}

	{#if !segment}
		<p class="empty">{msg.action_form_no_segment()}</p>
	{:else}
		<p class="seg">{inSegment[0]}<b>{segmentLabel}</b>{inSegment[1]}<span class="muted">{msg.action_form_no_cross()}</span></p>
		<div class="grid">
			<label class="wide">
				<span class="cap">{msg.action_form_category()}</span>
				<select
					value={draft.category}
					onchange={(e) => setCategory(e.currentTarget)}
				>
					{#each ACTION_CATEGORIES as c (c.key)}<option value={c.key}>{whyText(categoryWhy(c.key))}</option>{/each}
				</select>
				{@render errorAtSpot('category')}
			</label>
			{#if draft.offerDefaultRoles}
				<p class="wide roles-offer" role="note">
					{msg.action_form_roles_not_default({ category: categoryLabel })}
					<button type="button" class="link" onclick={useDefaultRoles}>{msg.action_form_use_default_roles({ category: categoryLabel })}</button>
				</p>
			{/if}
			<fieldset class="wide colors">
				<legend class="cap">{msg.action_form_color()}</legend>
				<label class="swatch auto" title={msg.action_form_category_color()} style:--c={CATEGORY_COLORS[draft.category]}>
					<input
						type="radio"
						name="action-color"
						aria-label={msg.action_form_category_color()}
						checked={!draft.color}
						onchange={() => setColor(undefined)}
					/>{msg.action_form_by_category()}
				</label>
				{#each ACTION_COLORS as c (c.value)}
					<label class="swatch" title={whyText(c.label)} style:--c={c.value}>
						<input
							type="radio"
							name="action-color"
							aria-label={whyText(c.label)}
							checked={draft.color === c.value}
							onchange={() => setColor(c.value)}
						/>
					</label>
				{/each}
			</fieldset>
			{@render errorAtSpot('color', true)}
			<div class="field">
				<span class="start-cap">
					<span class="cap" aria-hidden="true">{msg.action_form_start()}</span>
					{#if action}
						<button type="button" class="link" onclick={() => editor.seekToAction(action.id)}>{msg.action_form_go_to_start()}</button>
					{/if}
				</span>
				<input
						aria-label={msg.action_form_start()}
						bind:value={draft.startText}
						onchange={() => changed('start')}
						onkeydown={(e) => addOnEnter(e, 'start')}
						onfocus={() => draft.focusSlotField('startText')}
						onblur={() => draft.focusSlotField(null)}
					/>
				<small
					>{segment.kind === 'music'
						? msg.action_form_start_hint_music()
						: msg.action_form_start_hint_chant({ example: timeExamples(flow, segment.id).here })}</small
				>
				{@render errorAtSpot('start')}
			</div>
			<!-- 新動作表單一打開，就把開始、長度捲出來，不停在黏底的「新增動作」後面（N03，故事 67） -->
			<div class="field" {@attach !action && reveal()}>
				<span class="cap" aria-hidden="true">{msg.action_form_length()}</span>
				<input
						aria-label={msg.action_form_length()}
						bind:value={draft.lengthText}
						onchange={lengthChanged}
						onkeydown={(e) => addOnEnter(e, 'length')}
						onfocus={() => draft.focusSlotField('lengthText')}
						onblur={() => draft.focusSlotField(null)}
					/>
				<small>{segment.kind === 'music' ? msg.action_form_length_hint_music() : msg.action_form_length_hint_chant()}</small>
				{@render errorAtSpot('length')}
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
				<span class="cap">{msg.action_form_people_head({ n: draft.members.length })}</span>
				<span class="legend">
					<button
						type="button"
						class="ghost bang"
						aria-label={msg.action_form_legend_button()}
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
						<span
							><b class="name F">{msg.action_form_legend_name()}</b>{msg.members_gender_f()}　<b class="name M"
								>{msg.action_form_legend_name()}</b
							>{msg.members_gender_m()}</span
						>
						<span>{msg.action_form_legend_together()}</span>
						<span>{msg.action_form_legend_keys()}</span>
						<span class="keys">
							{#each roles as r (r.name)}{#if r.key}<kbd>{r.key} {roleText(r.name)}</kbd>{/if}{/each}
							<kbd>{msg.action_form_key_no_role()}</kbd>
						</span>
						<!-- 其他快捷鍵（⌘C／⌘V、按住 H、Alt＋拖…）不在這裡列，連到使用說明的快捷鍵表 -->
						<a href={`${resolve('/guide')}?from=editor#keys`} target="_blank" rel="noopener">{msg.action_form_all_shortcuts()}</a>
					</span>
				</span>
				<button type="button" class="link" onclick={() => openGlossary(null)}>{msg.action_form_glossary()}</button>
			</div>
			<!-- 常駐一行（觸控的人看不到 title）；選了 2 人以上換成選了幾人，這一行不跳 -->
			{#if together.length > 1}
				<p class="together" role="note" aria-label={msg.action_form_together_label()}>
					{msg.action_form_together({ n: together.length })}{#if keptOnly.length}{msg.action_form_together_kept({
							roles: joinText(keptOnly.map(roleText))
						})}{/if}
				</p>
			{:else if draft.members.length > 1}
				<p class="together">
					{touchScreen ? msg.action_form_multi_touch() : msg.action_form_multi_shift()}
				</p>
			{/if}
			{#if draft.members.length}
				<div class="squads" class:grouped>
					{#each cards as card (card.head)}
						<section class="squad" style:--c={card.color || null} aria-label={card.head || undefined}>
							{#if card.head}<h4 class="squad-head" class:none={!card.color}>{card.head}</h4>{/if}
							<ul>
								{#each card.rows.map((i) => ({ m: draft.members[i], i })) as { m, i } (m.memberId)}
									{@const who = memberOf(m.memberId)}
									<li>
										<span class="who">
											<button
												type="button"
												class="pick"
												aria-label={nameOf(m.memberId)}
												aria-pressed={together.includes(m.memberId)}
												title={msg.action_form_pick_title({ name: nameOf(m.memberId) })}
												onclick={(e) => pickRow(m.memberId, e.shiftKey || session.multiSelect)}
											>
												<span class="name {who?.gender ?? ''}">{nameOf(m.memberId)}</span>
											</button>
											{#if busy.get(m.memberId)}<span class="busy-tag"
													>{msg.action_form_busy_tag({ action: actionText(busy.get(m.memberId)!) })}</span
												>{/if}
										</span>
										<RolePicker
											bind:this={rolePickers[i]}
											label={msg.action_form_role_of({ name: nameOf(m.memberId) })}
											value={m.role}
											roles={rolesFor(m.role)}
											onpick={(role, byKey) => setRole(i, role, byKey)}
											onnew={() => openGlossary(i)}
										/>
										<button
											type="button"
											class="ghost icon"
											data-remove-member
											aria-label={msg.action_form_remove_member({ name: nameOf(m.memberId) })}
											onclick={() => removeMember(i)}><Icon name="close" size={14} /></button
										>
									</li>
								{/each}
							</ul>
						</section>
					{/each}
				</div>
			{:else}
				<p class="muted none">{msg.action_form_no_members()}</p>
			{/if}
			{#if busyHere.length}
				<p class="hint-warn" role="note">
					{msg.action_form_busy_here({ names: joinText(busyHere.map((m) => nameOf(m.memberId))) })}
					<button type="button" class="link" onclick={dropBusy}>{msg.action_form_drop_busy()}</button>
				</p>
			{/if}
			{#each actionHints(draft) as hint (hint.code)}<p class="hint-warn" role="note">{whyText(hint)}</p>{/each}
			{#if pickedOutside.length}
				<button type="button" class="add-picked" onclick={addSelected}
					><Icon name="plus" size={14} />{(pickedOutside.length === 1 ? msg.action_form_add_picked_one : msg.action_form_add_picked)({
						n: pickedOutside.length
					})}</button
				>
			{/if}
			<div class="adders">
				<select aria-label={msg.action_form_add_member()} data-add-member onchange={(e) => addMember(e.currentTarget)}>
					<option value="">{msg.action_form_add_member_option()}</option>
					{#each others as m (m.id)}
						{@const a = busy.get(m.id)}
						<option value={m.id}>{a ? msg.action_form_member_busy({ name: m.name, action: actionText(a) }) : m.name}</option>
					{/each}
				</select>
				{#if copySources.length}
					<div class="copy">
						<select aria-label={msg.action_form_copy_from()} aria-describedby="copy-why" onchange={(e) => copyFrom(e.currentTarget)}>
							<option value="">{msg.action_form_copy_from_option()}</option>
							{#each copySources as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
						</select>
						<small class="muted" id="copy-why">{msg.action_form_copy_why()}</small>
					</div>
				{/if}
			</div>
			{@render errorAtSpot('people')}
		</div>

		<label class="note">
			<span class="cap note-cap">{msg.text_length_note()}<CharCount field="note" input={noteInput} value={draft.note} /></span>
			<textarea aria-label={msg.text_length_note()} rows="2" bind:value={draft.note} bind:this={noteInput} onchange={() => changed('note')}></textarea>
			{@render errorAtSpot('note')}
		</label>

		{#if action}
			<!-- 轉接（例如 Lib 轉金字塔）：開新表單接在結束拍後面，人、任務角色、組帶過去 -->
			<button type="button" class="next" onclick={() => (draft.next(), keepFocus())}><Icon name="plus" size={14} />{msg.action_form_next()}</button>
			<CueGrid {action} {cellAt} />
		{:else}
			<!-- 黏在右邊欄底部：表單很長時不用捲到最下面才按得到 -->
			<div class="add-bar" {@attach stickyBottom}>
				{@render errorAtSpot('add')}
				<button
					type="button"
					class="primary add"
					disabled={!draft.members.length}
					aria-describedby={draft.members.length ? undefined : 'add-why'}
					onclick={() => ((errorAt = 'add'), draft.add(), keepFocus())}>{msg.action_form_add()}</button
				>
				{#if !draft.members.length}<p class="muted why" id="add-why">{msg.action_form_add_why()}</p>{/if}
			</div>
		{/if}
	{/if}

	<!-- 「刪除動作」畫在標題右邊，但在 Tab 順序的最後：在名稱按 Tab 不會先跳到它。 -->
	{#if action}
		<button type="button" class="danger remove" onclick={remove}><Icon name="trash" size={14} />{msg.action_form_remove()}</button>
	{/if}

	<!-- 問句在拍點格子下面，常在看得到的範圍外：出現時捲過去。 -->
	{#if ask.question && !askAtLength}
		<div {@attach reveal(ask.failures)}>
			<ConfirmList {ask} />
		</div>
	{/if}

	<!-- 不是哪一格送的（例：刪除動作被擋）：寫在最下面。右邊欄很長時會在看得到的範圍下面，按了像沒反應：出現時捲過去。 -->
	{#if ask.error && errorAt === null}<p class="error" {@attach revealAlert(ask.failures)}>{ask.error}</p>{/if}
</section>
{/if}

{#if glossaryOpen}
	<RoleGlossary onclose={() => (glossaryOpen = false)} onadded={roleAdded} />
{/if}

<style>
	.action-form:focus {
		outline: none;
	}
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
	.new.collapsed {
		padding: 10px 12px;
		font-size: 14px;
		font-weight: 600;
		background: var(--new-bg);
		border-color: var(--new-line);
	}
	.collapsed-hint {
		font-size: 12px;
		text-align: center;
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
	/* 點名字選人（Shift＋點選好幾個）：看起來跟原本的名字一樣，選到的框起來 */
	.pick {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 1px;
		font: inherit;
		color: inherit;
		background: none;
		border: 1px solid transparent;
		border-radius: 999px;
		cursor: pointer;
	}
	.pick[aria-pressed='true'] {
		border-color: var(--sel);
		box-shadow: 0 0 0 2px var(--sel-soft);
	}
	.together {
		margin: 0;
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.copy {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.copy small {
		font-size: 11px;
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
	.squads {
		display: grid;
		gap: 8px;
	}
	/* 一組一張小卡：標題用組的顏色寫一次 */
	.grouped .squad {
		display: grid;
		gap: 4px;
		align-content: start;
		padding: 6px 8px 8px;
		border: 1px solid var(--line-soft, #e8ecf3);
		border-top: 3px solid var(--c, var(--line, #d8dee9));
		border-radius: 8px;
		min-width: 0;
	}
	.squad-head {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		color: var(--c);
	}
	.squad-head.none {
		color: var(--muted, #66718a);
		font-weight: 400;
	}
	.busy-tag {
		font-size: 11px;
		color: var(--danger, #c8372d);
		white-space: nowrap;
	}
	.add-picked {
		justify-self: start;
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
		/* 不分組：人分兩欄；分組：卡片分兩欄，卡片裡一欄 */
		.squads:not(.grouped) ul,
		.squads.grouped {
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
