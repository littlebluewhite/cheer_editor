<script lang="ts">
	// 分組浮動列：選到有環節、要分組的動作時，在場地下面（「正面／裁判」那一排）出現。只在編排畫面。
	// 有選人：按號碼放進那一組、「＋」放進新的一組、「✕」移出組；選的人一次改好，是一個復原步驟。
	// 選的人都在同一組時，那一組的號碼是按下的（看得出現在在哪一組）。
	// 沒選人：按號碼把那一組的人全選起來。「n 人沒分組」把沒分組的人選起來。
	// 電腦上選好人按數字鍵 1–9、0 也一樣：都叫 session 的 squadKey（頁面收鍵盤）。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { squadBadge, squadsOf, type Action } from '#lib/core';
	import { m } from '#lib/paraglide/messages.js';
	import ConfirmList from './ConfirmList.svelte';
	import { revealAlert } from './reveal';

	interface Props {
		/** 選到的、要分組的動作（session.groupingAction）。 */
		action: Action;
	}

	let { action }: Props = $props();

	const session = getEditorSession();
	/** 換組會動到紀錄時，等教練回答（保留舊紀錄／清掉重算，或確定）。 */
	const ask = session.squadAsk;

	/** 現在有的組和它們的徽章，組號 1 到 n 不跳號（組號照組 id 的先後算）。 */
	const squads = $derived(squadsOf(action));
	const badges = $derived(squads.map((squad) => squadBadge(action, { squad })));
	const next = $derived(badges.length + 1);
	const selected = $derived(session.selectedMemberIds);
	const picked = $derived(session.squadPicked);
	const outside = $derived(selected.length - picked.length);
	const loose = $derived(action.members.filter((m) => m.squad === undefined).map((m) => m.memberId));
	/** 選的人都在同一組：那一組的 id；沒選人、有人沒分組或分在不同組是 undefined。 */
	const current = $derived.by(() => {
		const of = new Set(picked.map((id) => action.members.find((m) => m.memberId === id)?.squad));
		return of.size === 1 ? [...of][0] : undefined;
	});
	const outsideText = $derived(outside ? m.selection_outside({ n: outside }) : '');

	// 換動作時（和剛出現時），沒回答的問題和原因收掉。
	$effect(() => {
		void action.id;
		ask.clear();
	});

	/** 號碼：有選人是放進那一組；沒選人是把那一組的人選起來。 */
	function number(n: number) {
		if (picked.length) session.squadKey(n);
		else session.selectMembers(action.members.filter((m) => m.squad === squads[n - 1]).map((m) => m.memberId));
	}
</script>

<div class="squad-bar" role="group" aria-label={m.selection_squads()} data-edit>
	{#if ask.question}
		<div class="ask">
			<ConfirmList {ask} />
		</div>
	{/if}
	<span class="who">
		{#if picked.length}{outside
				? m.selection_squad_picked_outside({ n: picked.length, outside: outsideText })
				: m.selection_count({ n: picked.length })}
		{:else if outside}{m.selection_squad_outside_hint({ outside: outsideText })}
		{:else}{m.selection_squad_hint()}{/if}
	</span>
	{#each badges as b, i (b.number)}
		<button
			type="button"
			class="num"
			style:--c={b.color}
			aria-pressed={current !== undefined && squads[i] === current}
			aria-label={picked.length ? m.selection_squad_put({ n: b.number }) : m.selection_squad_select({ n: b.number })}
			onclick={() => number(b.number)}>{b.text}</button
		>
	{/each}
	<button type="button" class="num new" aria-label={m.selection_squad_new()} disabled={!picked.length} onclick={() => session.squadKey(next)}
		>＋</button
	>
	<button type="button" class="num out" aria-label={m.selection_squad_out()} disabled={!picked.length} onclick={() => session.squadKey(0)}>✕</button>
	{#if loose.length}
		<button type="button" class="link" onclick={() => session.selectMembers(loose)}>{m.selection_loose({ n: loose.length })}</button>
	{/if}
	{#if ask.error}<span class="error" {@attach revealAlert(ask.failures)}>{ask.error}</span>{/if}
</div>

<style>
	.squad-bar {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		background: var(--surface, #fff);
		border: 1px solid var(--line);
		border-radius: 999px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
		font-size: 13px;
	}
	/* 問紀錄的確認框浮在浮動列上面。 */
	.ask {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		width: min(420px, 90vw);
		z-index: 5;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
		border-radius: 10px;
	}
	.who {
		margin-right: 4px;
	}
	.num {
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 50%;
		border: 0;
		background: var(--c);
		color: #fff;
		font-weight: 700;
		font-size: 14px;
	}
	/* 選的人現在在的那一組：外面一圈深色（用陰影畫；外框留給焦點的青色框）。 */
	.num[aria-pressed='true'] {
		box-shadow:
			0 0 0 2px #fff,
			0 0 0 4px var(--ink, #16213a);
	}
	.num.new {
		background: #fff;
		color: #111;
		border: 2px dashed #9ca3af;
	}
	.num.out {
		background: #e5e7eb;
		color: #374151;
	}
	.num:disabled {
		opacity: 0.35;
	}
	.link {
		border: 0;
		background: none;
		text-decoration: underline;
		padding: 0 4px;
	}
	.error {
		color: var(--danger, #c8372d);
	}
	/* 觸控螢幕按鈕變大（docs/adr/0005-ipad-touch.md）。 */
	@media (pointer: coarse) {
		.num {
			width: 40px;
			height: 40px;
			font-size: 16px;
		}
		.link {
			min-height: 40px;
		}
	}
</style>
