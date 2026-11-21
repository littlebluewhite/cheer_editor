<!--
	書籤（GLOSSARY「書籤」）：一排小鈕，點了只有 A 的跳到 A，有 B 的把重複範圍換成 A 到 B、打開重複、跳到 A；
	正在重複的那個亮著，再點一下就關掉重複（手機的「重複」收在「⋯」裡，這樣才關得掉）。照 A 的時間排。
	place="bar"：電腦、橫拿的 iPad，放在播放列上 A、B 旁邊；書籤圖示存現在的 A、B，「管理」才出現改名、刪除。
	  檢視模式這兩顆只變灰、不拿掉（跟復原、重做一樣），切模式時上方列才不跑。
	  按 / 跳出找書籤的框（頁面的快捷鍵叫 openSearch）。
	place="phone"：手機、直拿的 iPad（檢視模式），播放列下面一排，手指左右滑；沒有書籤就不出現。
	這裡只管版面和按鍵：怎麼用書籤、哪個正在播、要存的 A、B 問播放 module；同一個地方要閃哪個照流程核心回的 id。
-->
<script lang="ts">
	import { MAX_CHARS, actionNameWhy, bookmarkAction, firstChars, bookmarkSeconds, positionWhy, type Bookmark, type TimePosition } from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { m } from '#lib/paraglide/messages.js';
	import { whyText } from '#lib/reason-text.js';
	import { composing } from '#lib/ime.js';
	import { KEYS } from '#lib/shortcuts.js';
	import { isTouchScreen } from '#lib/editor-layout.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import CharCount from './CharCount.svelte';
	import Icon from './Icon.svelte';

	let { place }: { place: 'bar' | 'phone' } = $props();

	const { session, playback } = getEditor();
	const flow = $derived(session.flow!);
	const editable = $derived(place === 'bar' && session.editable);

	// 上方列 1441 寬以上才放得下一排書籤；窄一點收成一顆鈕，點了在下面開小窗（流程名字才露得出來，check:layout 量）
	const WIDE = '(min-width: 1441px)';
	let wide = $state(typeof matchMedia !== 'function' || matchMedia(WIDE).matches);
	$effect(() => {
		if (typeof matchMedia !== 'function') return;
		const m = matchMedia(WIDE);
		m.onchange = () => (wide = m.matches);
		wide = m.matches;
		return () => (m.onchange = null);
	});
	const folded = $derived(place === 'bar' && !wide);
	let open = $state(false);
	let openBtn = $state<HTMLButtonElement>();
	function closeFold(by: 'outside' | 'escape') {
		open = false;
		if (by === 'escape') openBtn?.focus();
	}

	/** 書籤現在在哪（全域秒數），帶著它的 id。 */
	type Spot = { id: string; a: number; b: number | null };
	/** 放得下的書籤，照 A 的時間排（一樣的話先存的先）。 */
	const rows = $derived(
		(flow.bookmarks ?? [])
			.flatMap((bm) => {
				const s = bookmarkSeconds(flow, bm);
				return s ? [{ bm, s: { id: bm.id, ...s } as Spot }] : [];
			})
			.sort((x, y) => x.s.a - y.s.a)
	);

	function where(s: Spot): string {
		const a = whyText(positionWhy(flow, s.a));
		return s.b === null ? a : m.bookmark_bar_range({ a, b: whyText(positionWhy(flow, s.b)) });
	}
	/** 正在重複的就是這個書籤（播放 module 回答）。 */
	const active = (s: Spot) => playback.playingBookmark === s.id;

	/** 點書籤：正在重複的再點一下關掉重複；不然用它（播放 module 管怎麼用）。 */
	function go({ bm, s }: { bm: Bookmark; s: Spot }) {
		open = false;
		if (active(s)) playback.setRepeat(false);
		else playback.useBookmark(bm);
	}

	// ---------- 存、改名、刪（只有 bar、能改時） ----------
	/** 正在打名字的：新的（帶著要存的 A、B）或改名的那個。 */
	let naming = $state<{ kind: 'add'; a: TimePosition; b: TimePosition | null } | { kind: 'rename'; id: string } | null>(null);
	let text = $state('');
	let nameInput = $state<HTMLInputElement>();
	let managing = $state(false);
	/** 閃一下的書籤（要存的地方已經有書籤了）。 */
	let flashId = $state<string | null>(null);
	// 切到檢視模式：打到一半的名字、管理收起來
	$effect(() => {
		if (!editable) {
			naming = null;
			managing = false;
		}
	});

	function startAdd() {
		// 要存的 A、B 問播放 module（有重複範圍照它原樣，沒有是播放頭最近的整拍）
		const spot = playback.bookmarkSpot;
		if (!spot) return;
		const { a, b } = spot;
		// A 剛好在一個動作開始的地方：名字先填那個動作的名字
		const act = bookmarkAction(flow, a);
		naming = { kind: 'add', a, b };
		text = act ? firstChars(whyText(actionNameWhy({ ...act, name: act.name.trim() })), MAX_CHARS.bookmarkName) : '';
	}

	function commit() {
		const n = naming;
		if (!n) return;
		if (n.kind === 'add') {
			const r = session.ask.send({ name: 'addBookmark', args: [text, n.a, n.b] });
			if (r.kind === 'ok') naming = null;
			// 只有位置重複才閃：別的原因（例：段被刪了，秒數算成 0）會閃到不相干的書籤。
			// 欄位收起來：這個位置換什麼名字都存不了；開著時上方列 1600 寬以下書籤那排會被擠到 0 寬，閃了也看不到（check:layout 量）
			else if (r.kind === 'blocked' && r.bookmarkId) {
				naming = null;
				flash(r.bookmarkId);
			}
		} else {
			const r = session.ask.send({ name: 'renameBookmark', args: [n.id, text] });
			if (r.kind === 'ok') naming = null;
		}
	}

	/** 閃那個書籤（流程核心說撞到的那個）。 */
	function flash(id: string) {
		flashId = null;
		// 等欄位收起來、那排拉開了再捲過去
		requestAnimationFrame(() => {
			flashId = id;
			document.getElementById(chipId(id))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		});
	}

	function nameKeys(e: KeyboardEvent) {
		// 打字的鍵不給頁面（空白鍵不播放、方向鍵不移播放頭）；存檔的鍵照樣給頁面
		if (saveKey(e)) return;
		e.stopPropagation();
		if (composing(e)) return;
		if (e.key === 'Enter') commit();
		else if (e.key === 'Escape') naming = null;
	}

	/** ⌘S／Ctrl+S：存檔，打字時也要給頁面。 */
	const saveKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
	const chipId = (id: string) => `bookmark-${place}-${id}`;
	// 改名的欄位在左右滑的那排裡：捲到看得到
	const selectAll = (el: HTMLInputElement) => {
		el.select();
		el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	};

	// ---------- 找書籤（按 /） ----------
	let searching = $state(false);
	let query = $state('');
	let pick = $state(0);
	const found = $derived(rows.filter((r) => r.bm.name.toLowerCase().includes(query.trim().toLowerCase())));

	/** 頁面按 / 時叫：打開找書籤的框。回傳有沒有打開（手機那排沒有）。 */
	export function openSearch(): boolean {
		if (place !== 'bar') return false;
		// 收成一顆鈕的小窗先收：它的 Esc 會先搶走，框還開著焦點卻跑到框後面
		open = false;
		searching = true;
		query = '';
		pick = 0;
		return true;
	}

	/** 找書籤的框整個（輸入框和每一列）：鍵不給底下的編輯頁（Delete 不刪選著的動作），存檔的鍵照樣給；Esc 關掉。 */
	function boxKeys(e: KeyboardEvent) {
		if (saveKey(e)) return;
		e.stopPropagation();
		if (e.key === 'Escape' && !composing(e)) searching = false;
	}

	/** 焦點（Tab、Shift+Tab）跑到框外：框關掉，不會框還開著、鍵卻給了編輯頁。點東西時焦點沒去哪（relatedTarget 空的）不算。 */
	function boxLeave(e: FocusEvent) {
		const to = e.relatedTarget as Node | null;
		if (to && !(e.currentTarget as HTMLElement).contains(to)) searching = false;
	}

	/** 找書籤的輸入框：↑↓ 選、Enter 跳過去。 */
	function searchKeys(e: KeyboardEvent) {
		if (composing(e)) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			pick = Math.max(0, Math.min(found.length - 1, pick + (e.key === 'ArrowDown' ? 1 : -1)));
		} else if (e.key === 'Enter' && found[pick]) {
			go(found[pick]);
			searching = false;
		}
	}

	const hint = $derived(place === 'bar' && !isTouchScreen() ? m.bookmark_bar_search_hint({ key: KEYS.bookmarkSearch.mac }) : undefined);
</script>

{#if folded}
	<button
		type="button"
		class="chip fold"
		aria-label={m.bookmark_bar_label()}
		aria-expanded={open}
		title={hint ?? m.bookmark_bar_label()}
		bind:this={openBtn}
		onclick={() => (open = !open)}><Icon name="bookmarks" size={14} /></button
	>
	<!-- 小窗放在書籤鈕下面、左邊對齊；點外面、按 Esc 就收（popover.svelte.ts） -->
	{#if open}
		<div class="bookmarks pop" role="group" aria-label={m.bookmark_bar_label()} {@attach popover({ place: below(openBtn!, { gap: 6, align: 'left', flip: true }), close: closeFold, inside: [openBtn] })}>
			{#if !rows.length}<p class="none">{m.bookmark_bar_none()}</p>{/if}
			{@render chips()}
			{@render tools()}
		</div>
	{/if}
{:else if place === 'bar'}
	<!-- 書籤多的時候左右滑的只有書籤那幾顆；存、管理、打名字的欄位一直露在外面 -->
	<div class="bookmarks bar" role="group" aria-label={m.bookmark_bar_label()} title={hint}>
		<div class="list">{@render chips()}</div>
		{@render tools()}
	</div>
{:else if rows.length}
	<div class="bookmarks {place}" role="group" aria-label={m.bookmark_bar_label()} title={hint}>
		{@render chips()}
	</div>
{/if}

{#snippet chips()}
	{#each rows as row (row.bm.id)}
		{@const { bm, s } = row}
		{#if naming?.kind === 'rename' && naming.id === bm.id}
			<span class="chip naming">
				<input type="text" aria-label={m.bookmark_bar_name()} data-scratch bind:this={nameInput} bind:value={text} onkeydown={nameKeys} {@attach selectAll} />
				<CharCount field="bookmarkName" input={nameInput} value={text} />
				<button type="button" class="mini" onclick={commit}>{m.bookmark_bar_save()}</button>
			</span>
		{:else}
			<span class="chip" class:on={active(s)} class:flash={flashId === bm.id} id={chipId(bm.id)} onanimationend={() => (flashId = null)}>
				<button
					type="button"
					class="go"
					aria-pressed={s.b === null ? undefined : active(s)}
					title={active(s) ? m.bookmark_bar_click_again({ where: where(s) }) : where(s)}
					onclick={() => go(row)}
					><span class="kind" aria-hidden="true">{s.b === null ? '↦' : '⟳'}</span><span class="nm">{bm.name}</span></button
				>
				{#if editable && managing}
					<button type="button" class="mini" aria-label={m.bookmark_bar_rename({ name: bm.name })} onclick={() => ((naming = { kind: 'rename', id: bm.id }), (text = bm.name))}>✎</button>
					<button
						type="button"
						class="mini"
						aria-label={m.bookmark_bar_delete({ name: bm.name })}
						onclick={() => session.ask.send({ name: 'deleteBookmark', args: [bm.id] })}>✕</button
					>
				{/if}
			</span>
		{/if}
	{/each}
{/snippet}

{#snippet tools()}
	{#if place === 'bar'}
		{#if naming?.kind === 'add'}
			<span class="chip naming">
				<input
					type="text"
					aria-label={m.bookmark_bar_name()}
					placeholder={m.bookmark_bar_placeholder()}
					data-scratch
					bind:this={nameInput}
					bind:value={text}
					onkeydown={nameKeys}
					{@attach selectAll}
				/>
				<CharCount field="bookmarkName" input={nameInput} value={text} />
				<button type="button" class="mini" onclick={commit}>{m.bookmark_bar_save()}</button>
				<button type="button" class="mini" aria-label={m.bookmark_bar_cancel()} onclick={() => (naming = null)}>✕</button>
			</span>
		{:else}
			<button
				type="button"
				class="chip add"
				aria-label={m.bookmark_bar_add()}
				title={editable ? m.bookmark_bar_add_title() : m.bookmark_bar_add_view_only()}
				disabled={!editable || !flow.segments.length}
				onclick={startAdd}><Icon name="bookmark" /><span class="add-text" class:alone={!rows.length}>{m.bookmark_bar_label()}</span></button
			>
		{/if}
		{#if rows.length}
			<button type="button" class="chip manage" aria-pressed={managing} disabled={!editable} onclick={() => (managing = !managing)}
				>{managing ? m.bookmark_bar_done() : m.bookmark_bar_manage()}</button
			>
		{/if}
	{/if}
{/snippet}

{#if searching}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="veil" onpointerdown={(e) => e.target === e.currentTarget && (searching = false)}>
		<div class="search" role="dialog" aria-label={m.bookmark_bar_search()} tabindex="-1" onkeydown={boxKeys} onfocusout={boxLeave}>
			<input
				type="text"
				aria-label={m.bookmark_bar_search()}
				placeholder={m.bookmark_bar_search_placeholder()}
				data-scratch
				bind:value={query}
				oninput={() => (pick = 0)}
				onkeydown={searchKeys}
				{@attach (el) => el.focus()}
			/>
			<ul>
				{#each found as row, i (row.bm.id)}
					<li>
						<button
							type="button"
							class:pick={i === pick}
							class:on={active(row.s)}
							onpointerenter={() => (pick = i)}
							onclick={() => {
								go(row);
								searching = false;
							}}
							><span class="kind" aria-hidden="true">{row.s.b === null ? '↦' : '⟳'}</span><span class="nm">{row.bm.name}{#if active(row.s)}<span class="looping">{m.bookmark_bar_looping()}</span>{/if}</span><span class="at"
								>{where(row.s)}</span
							></button
						>
					</li>
				{:else}
					<li class="empty">{rows.length ? m.bookmark_bar_not_found() : m.bookmark_bar_none_hint()}</li>
				{/each}
			</ul>
			<p class="hint">{m.bookmark_bar_search_keys()}</p>
		</div>
	</div>
{/if}

<style>
	.bookmarks {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.bookmarks::-webkit-scrollbar {
		display: none;
	}
	/* 一排書籤最多多寬：再寬流程名字就露不出 8 個字（check:layout 量的）；放不下的書籤左右滑，存、管理不滑 */
	.bar {
		flex: 0 1 auto;
		max-width: 190px;
		overflow: visible;
	}
	/* 擠的時候先縮書籤那排（縮到沒有也行），再縮打名字的欄位 */
	.bar .list {
		display: flex;
		flex: 0 999 auto;
		align-items: center;
		gap: 4px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.bar .list::-webkit-scrollbar {
		display: none;
	}
	/* 只縮存成書籤的欄位；改名的那顆在書籤那排裡，照原本的寬，放不下就左右滑 */
	.bar > .naming {
		flex: 0 1 auto;
		min-width: 0;
	}
	.bar > .naming input {
		min-width: 3em;
	}
	@media (min-width: 1601px) {
		.bar {
			max-width: 270px;
		}
	}
	@media (min-width: 1761px) {
		.bar {
			max-width: 310px;
		}
	}
	@media (min-width: 1921px) {
		.bar {
			max-width: 400px;
		}
	}
	/* 窄一點的上方列：一顆鈕，跟 A、B 一樣小 */
	.fold {
		justify-content: center;
		min-width: 24px;
		padding: 0 4px;
		cursor: pointer;
	}
	.fold[aria-expanded='true'] {
		background: #26314d;
	}
	/* 小窗：開在最上層（popover），蓋掉瀏覽器給 popover 的置中、框線、顏色；跟上方列一樣深底 */
	.pop {
		position: fixed;
		inset: auto;
		margin: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		width: max-content;
		max-width: min(320px, 90vw);
		max-height: 60vh;
		padding: 10px;
		overflow: hidden auto;
		border: 1px solid #36425f;
		border-radius: 8px;
		background: var(--ink);
		color: #c9d2e6;
		box-shadow: var(--shadow-pop);
	}
	.pop .go {
		max-width: 16em;
	}
	.none {
		margin: 0 4px;
		font-size: 13px;
		color: #8b96b0;
	}
	.phone {
		padding: 0 8px 6px;
		background: var(--ink);
		-webkit-overflow-scrolling: touch;
	}
	.chip {
		flex: none;
		display: inline-flex;
		align-items: center;
		min-height: 26px;
		padding: 0;
		border: 1px solid #36425f;
		border-radius: 999px;
		background: transparent;
		color: #c9d2e6;
		font-size: 13px;
		white-space: nowrap;
	}
	.chip.on {
		background: var(--sel);
		border-color: var(--sel);
		color: var(--ink);
	}
	.chip.on .kind {
		color: inherit;
	}
	.chip.flash {
		animation: flash 0.4s 3;
	}
	@keyframes flash {
		50% {
			background: var(--warn-bg);
			color: var(--ink);
		}
	}
	.go {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 11em;
		padding: 3px 10px;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
	}
	.nm {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kind {
		color: #8fb3ff;
	}
	.add,
	.manage {
		padding: 3px 10px;
		cursor: pointer;
	}
	.add {
		gap: 4px;
		padding-inline: 7px;
	}
	.add:disabled,
	.manage:disabled {
		color: #5d6985;
		border-color: #2c3651;
		cursor: not-allowed;
	}
	/* 上方列擠：有書籤了、或 1600 寬以下，只留圖示；寬、又還沒有書籤時，圖示旁邊寫「書籤」 */
	.add-text:not(.alone) {
		display: none;
	}
	@media (max-width: 1600px) {
		.add-text {
			display: none;
		}
	}
	.manage[aria-pressed='true'] {
		background: #26314d;
	}
	.mini {
		min-width: 24px;
		height: 24px;
		padding: 0 5px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font-size: 12px;
	}
	.naming {
		gap: 2px;
		padding: 1px 2px 1px 6px;
		border-color: var(--sel);
	}
	.naming input {
		width: 9em;
		padding: 2px 4px;
		border: 0;
		background: transparent;
		color: #fff;
		font: inherit;
	}
	.naming input:focus {
		outline: none;
	}
	/* 手指：至少 32px */
	@media (pointer: coarse) {
		.chip,
		.go {
			min-height: 32px;
		}
		.mini,
		.fold {
			min-width: 32px;
		}
		.mini {
			height: 32px;
		}
	}
	.veil {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: rgb(10 15 30 / 0.4);
	}
	.search {
		position: fixed;
		top: 14vh;
		left: 50%;
		translate: -50% 0;
		width: min(480px, calc(100vw - 32px));
		padding: 10px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 12px 32px rgb(10 15 30 / 0.3);
	}
	.search input {
		box-sizing: border-box;
		width: 100%;
		margin-bottom: 6px;
	}
	.search ul {
		max-height: 50vh;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.search li button {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}
	.search li button.pick {
		background: var(--sel-soft);
	}
	.search .looping {
		font-weight: 400;
		color: var(--muted);
	}
	.search .kind {
		color: var(--mat);
	}
	.search .nm {
		font-weight: 700;
	}
	.search .at {
		margin-left: auto;
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
	}
	.empty,
	.hint {
		margin: 6px 10px;
		font-size: 13px;
		color: var(--muted);
	}
</style>
