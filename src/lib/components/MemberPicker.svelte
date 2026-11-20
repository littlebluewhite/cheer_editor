<script lang="ts">
	// 選人：一鍵選全隊、全部底層、全部上層、這一拍沒在動作裡的人、不選人；
	// 「沿用上一個動作的人」取播放頭以前最晚結束的動作，再按一次換更早的。
	// 按了鈕寫選了誰（選的人一改就收掉）；選不到人時不改選取，只寫原因。
	// 選到的人是在播放頭新增動作的人，也是場上整組拖的那一組。
	import { getEditor } from '#lib/editor.svelte.js';
	import { isTouchScreen } from '#lib/editor-layout.js';
	import { m } from '#lib/paraglide/messages.js';
	import { whyText, joinText } from '#lib/reason-text.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		actionWhy,
		memberGroup,
		memberName,
		previousActions,
		type MemberGroup
	} from '#lib/core';

	const session = getEditorSession();
	const { playback } = getEditor();
	const flow = $derived(session.flow!);
	const selected = $derived(session.selectedMemberIds);
	const select = (ids: string[]) => session.selectMembers(ids);
	/** 觸控螢幕才有「多選」開關，提示才提它（docs/adr/0005-ipad-touch.md）。 */
	const touchScreen = isTouchScreen();

	/** empty：選不到人時寫的原因。 */
	const GROUPS: { group: MemberGroup; label: string; empty: string }[] = [
		{ group: 'all', label: m.eight_count_whole_team(), empty: m.selection_no_members() },
		{ group: 'base', label: m.selection_all_bases(), empty: m.selection_no_bases() },
		{ group: 'top', label: m.selection_all_tops(), empty: m.selection_no_tops() },
		{ group: 'idle', label: m.selection_idle(), empty: m.selection_no_idle() }
	];

	/** 「沿用上一個動作的人」這次要拿第幾個候選；播放頭一動就從最晚結束的重來。 */
	let cycle = { sec: NaN, index: 0 };
	/** 按了鈕以後的說明，和那時選的人：選的人一改（session 每次選都換一個新的陣列），說明就不對了，收掉。 */
	let said = $state.raw<{ text: string; selection: string[] } | null>(null);
	const message = $derived(said?.selection === selected ? said.text : '');

	/** 選一組人，寫說明；選不到人時不動選取，只寫原因。 */
	function pick(ids: string[], text: string, empty: string) {
		if (ids.length) select(ids);
		say(ids.length ? text : empty);
	}

	function say(text: string) {
		said = text ? { text, selection: session.selectedMemberIds } : null;
	}

	const names = $derived(selected.map((id) => memberName(flow, id)).filter(Boolean));
	/** 選到的人的名字接成一串（「、」或「, 」照語言）。 */
	const nameList = $derived(names.length ? joinText(names) : '');

	function previous() {
		const candidates = previousActions(flow, playback.sec);
		if (candidates.length === 0) return say(m.selection_no_previous());
		if (cycle.sec !== playback.sec) cycle = { sec: playback.sec, index: 0 };
		const action = candidates[cycle.index % candidates.length];
		cycle.index += 1;
		const picked = { action: whyText(actionWhy(action)), n: action.members.length };
		const text = candidates.length > 1 ? m.selection_previous_more(picked) : m.selection_previous(picked);
		pick(action.members.map((member) => member.memberId), text, '');
	}
</script>

<section class="picker">
	<header>
		<h3>{m.selection_title()}</h3>
		{#if names.length}<button type="button" class="link" onclick={() => select([])}>{m.selection_clear()}</button>{/if}
	</header>
	<div class="chips">
		{#each GROUPS as g (g.group)}
			<button type="button" onclick={() => pick(memberGroup(flow, g.group, playback.sec), '', g.empty)}
				>{g.label}</button
			>
		{/each}
		<button type="button" onclick={previous}>{m.selection_same_as_previous()}</button>
	</div>
	<!-- 說明和選人摘要各固定一行（太長用…，滑鼠移上去看全部）：按了鈕不會把下面的表單往下推 -->
	<div class="said">{#if message}<p class="muted" role="status" title={message}>{message}</p>{/if}</div>
	<p class="picked" class:none={!names.length} title={nameList}>
		{names.length ? m.selection_count_names({ n: names.length, names: nameList }) : m.selection_count({ n: 0 })}
	</p>
	<p class="muted">
		{touchScreen ? m.selection_hint_touch() : m.selection_hint_mouse()}
	</p>
</section>

<style>
	.picker {
		display: grid;
		gap: 8px;
		font-size: 13px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 22px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	p {
		margin: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chips button {
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 999px;
	}
	.said,
	.said p,
	.picked {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.said {
		min-height: 1.5em;
	}
	.picked {
		padding: 7px 10px;
		border-radius: 8px;
		background: var(--sel-soft, #dcf4fa);
		box-shadow: inset 3px 0 0 var(--sel, #19b4d8);
		font-weight: 500;
	}
	.picked.none {
		background: var(--surface-2, #f6f8fb);
		box-shadow: inset 3px 0 0 var(--line, #d8dee9);
		color: var(--muted, #66718a);
		font-weight: 400;
	}
	.muted {
		color: var(--muted, #66718a);
		font-size: 12px;
	}
</style>
