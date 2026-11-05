<script lang="ts">
	// 出發和到達：播放頭停在站位上（不是開頭那張）時，替選到的人（沒選人就是全隊有走位的人）設走到這張的出發和到達。
	// 在出發或到達按 Enter 就套用（選字中的 Enter 不算）。
	// 時間的寫法照流程核心：這一段只打段內時間，別的段前面加段名。規則都交給流程核心判斷；被擋就說原因。
	import { composing } from '#lib/ime.js';
	import { untrack } from 'svelte';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		clearWalks,
		formationAt,
		formationWalks,
		memberWalk,
		readTime,
		setTeamWalks,
		setWalks,
		timeText,
		type Walk
	} from '#lib/core';
	import { Ask } from './ask.svelte';

	interface Props {
		/** 播放頭，全域秒數。 */
		playheadSec: number;
	}

	let { playheadSec }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 選到的人；沒選人就是全隊。 */
	const selectedMemberIds = $derived(session.selectedMemberIds);

	const formation = $derived.by(() => {
		const f = formationAt(flow, playheadSec);
		return f && f !== flow.formations[0] && f.segmentId ? f : null;
	});
	/** 改誰：選到的人；沒選人是全隊有走位的人（兩張站位位置不同的人，站著不動的不寫）。 */
	const memberIds = $derived(
		selectedMemberIds.length
			? selectedMemberIds
			: formation
				? formationWalks(flow, formation.id).map((w) => w.memberId)
				: []
	);
	/** 現在的走法給教練看的樣子；選到的人不一樣時是空字串。 */
	const current = $derived.by(() => {
		if (!formation) return null;
		const home = formation.segmentId!;
		const texts = memberIds.map((id) => {
			const w = memberWalk(flow, formation.id, id)!;
			return { depart: timeText(flow, home, w.depart), arrive: timeText(flow, home, w.arrive) };
		});
		const same = (k: 'depart' | 'arrive') => (texts.every((t) => t[k] === texts[0][k]) ? texts[0][k] : '');
		return { depart: texts.length ? same('depart') : '', arrive: texts.length ? same('arrive') : '' };
	});

	let departText = $state('');
	let arriveText = $state('');
	/** 被擋的原因（出發、到達看不懂也算）。 */
	const ask = new Ask((f) => session.change(f));

	// 換站位、換選取、流程改了：欄位回到現在的走法。
	$effect(() => {
		const c = current;
		untrack(() => {
			departText = c?.depart ?? '';
			arriveText = c?.arrive ?? '';
			ask.clear();
		});
	});

	function apply() {
		if (!formation) return;
		const home = formation.segmentId!;
		const depart = readTime(flow, home, departText, '出發');
		const arrive = readTime(flow, home, arriveText, '到達');
		if (depart.kind === 'blocked') return void ask.send(() => depart);
		if (arrive.kind === 'blocked') return void ask.send(() => arrive);
		const walk: Walk = { depart: depart.value, arrive: arrive.value };
		const id = formation.id;
		const ids = selectedMemberIds;
		ask.send(() =>
			ids.length ? setWalks(flow, id, Object.fromEntries(ids.map((m) => [m, walk]))) : setTeamWalks(flow, id, walk)
		);
	}

	function onkeydown(e: KeyboardEvent) {
		// 中文輸入法選字時按的 Enter 不算
		if (e.key !== 'Enter' || composing(e)) return;
		e.preventDefault();
		apply();
	}

	function useDefault() {
		if (!formation) return;
		const id = formation.id;
		ask.send(() => clearWalks(flow, id, memberIds));
	}
</script>

{#if formation && current}
	<section class="walk-form">
		<h3>出發和到達<span class="muted">（{selectedMemberIds.length ? '選到的' : '全隊有走位的'} {memberIds.length} 人）</span></h3>
		<div class="grid">
			<div class="field">
				<span class="cap" aria-hidden="true">出發</span>
				<input aria-label="出發" bind:value={departText} {onkeydown} placeholder={current.depart ? '' : '每人不一樣'} />
			</div>
			<div class="field">
				<span class="cap" aria-hidden="true">到達</span>
				<input aria-label="到達" bind:value={arriveText} {onkeydown} placeholder={current.arrive ? '' : '每人不一樣'} />
			</div>
		</div>
		<small class="muted">這一段打「2-5」，口號段打秒數；別的段前面加段名，例：口號 1 12.3</small>
		<div class="buttons">
			<button type="button" class="primary" onclick={apply}>套用</button>
			<button type="button" onclick={useDefault} title="清掉設定：最後一個八拍才出發">用預設</button>
		</div>
		{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
	</section>
{/if}

<style>
	.walk-form {
		display: grid;
		gap: 10px;
		font-size: 13px;
		padding: 14px;
		border-radius: 12px;
		background: var(--surface-2, #f6f8fb);
		border: 1px solid var(--line-soft, #e8ecf3);
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	h3 .muted {
		font-weight: 400;
		margin-left: 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.field {
		display: grid;
		gap: 4px;
	}
	.cap {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	.field input {
		width: 100%;
	}
	small,
	.muted {
		font-size: 11px;
		color: var(--muted, #66718a);
	}
	.buttons {
		display: flex;
		gap: 8px;
	}
	p {
		margin: 0;
	}
</style>
