<script lang="ts">
	// 選人：一鍵選全隊、全部底層、全部上層、這一拍沒在動作裡的人、不選人；
	// 「沿用上一個動作的人」取播放頭以前最晚結束的動作，再按一次換更早的。
	// 按了鈕寫選了誰（選的人一改就收掉）；選不到人時不改選取，只寫原因。
	// 選到的人是在播放頭新增動作的人，也是場上整組拖的那一組。
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		actionLabel,
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
	const touchScreen = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

	/** empty：選不到人時寫的原因。 */
	const GROUPS: { group: MemberGroup; label: string; empty: string }[] = [
		{ group: 'all', label: '全隊', empty: '還沒有隊員' },
		{ group: 'base', label: '全部底層', empty: '沒有全局角色是底層的隊員' },
		{ group: 'top', label: '全部上層', empty: '沒有全局角色是上層的隊員' },
		{ group: 'idle', label: '這一拍沒在動作裡的人', empty: '這一拍每個人都在動作裡' }
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

	function previous() {
		const candidates = previousActions(flow, playback.sec);
		if (candidates.length === 0) return say('播放頭前面還沒有動作');
		if (cycle.sec !== playback.sec) cycle = { sec: playback.sec, index: 0 };
		const action = candidates[cycle.index % candidates.length];
		cycle.index += 1;
		const more = candidates.length > 1 ? '（再按一次換更早的動作）' : '';
		pick(action.members.map((m) => m.memberId), `選了「${actionLabel(action)}」的 ${action.members.length} 人${more}`, '');
	}
</script>

<section class="picker">
	<header>
		<h3>選人</h3>
		{#if names.length}<button type="button" class="link" onclick={() => select([])}>不選人</button>{/if}
	</header>
	<div class="chips">
		{#each GROUPS as g (g.group)}
			<button type="button" onclick={() => pick(memberGroup(flow, g.group, playback.sec), '', g.empty)}
				>{g.label}</button
			>
		{/each}
		<button type="button" onclick={previous}>沿用上一個動作的人</button>
	</div>
	<!-- 說明和選人摘要各固定一行（太長用…，滑鼠移上去看全部）：按了鈕不會把下面的表單往下推 -->
	<div class="said">{#if message}<p class="muted" role="status" title={message}>{message}</p>{/if}</div>
	<p class="picked" class:none={!names.length} title={names.join('、')}>
		選了 {names.length} 人{names.length ? `：${names.join('、')}` : ''}
	</p>
	<p class="muted">
		場上點人、拖空白處框選，或點泳道上的名字。要選好幾個人：{touchScreen ? '打開場地左邊的「多選」再點' : '按住 Shift 點'}。
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
