<script lang="ts">
	// 出發和到達：播放頭停在站位上（不是開頭那張）時，替選到的人（沒選人就是全隊）設走到這張的出發和到達。
	// 時間的寫法照流程核心：這一段只打段內時間，別的段前面加段名。規則都交給流程核心判斷；被擋就說原因。
	import { untrack } from 'svelte';
	import {
		clearWalks,
		formationAt,
		memberWalk,
		parseTime,
		setWalks,
		timeText,
		type Flow,
		type Walk
	} from '#lib/core';
	import { applyResult } from './form';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 選到的人；沒選人就是全隊。 */
		selectedMemberIds?: string[];
		onchange: (flow: Flow) => void;
	}

	let { flow, playheadSec, selectedMemberIds = [], onchange }: Props = $props();

	const formation = $derived.by(() => {
		const f = formationAt(flow, playheadSec);
		return f && f !== flow.formations[0] && f.segmentId ? f : null;
	});
	const memberIds = $derived(
		selectedMemberIds.length ? selectedMemberIds : flow.members.map((m) => m.id)
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
	let error = $state('');

	// 換站位、換選取、流程改了：欄位回到現在的走法。
	$effect(() => {
		const c = current;
		untrack(() => {
			departText = c?.depart ?? '';
			arriveText = c?.arrive ?? '';
			error = '';
		});
	});

	function apply() {
		if (!formation) return;
		const home = formation.segmentId!;
		const depart = parseTime(flow, home, departText);
		const arrive = parseTime(flow, home, arriveText);
		const hint = '，例：2-5（別的段前面加段名，例：口號 1 12.3）';
		if (!depart) return void (error = `出發看不懂${hint}`);
		if (!arrive) return void (error = `到達看不懂${hint}`);
		const walk: Walk = { depart, arrive };
		error = applyResult(setWalks(flow, formation.id, Object.fromEntries(memberIds.map((id) => [id, walk]))), onchange);
	}

	function useDefault() {
		if (!formation) return;
		error = applyResult(clearWalks(flow, formation.id, memberIds), onchange);
	}
</script>

{#if formation && current}
	<section class="walk-form">
		<h3>出發和到達<span class="muted">（{selectedMemberIds.length ? `選到的 ${memberIds.length} 人` : '全隊'}）</span></h3>
		<div class="grid">
			<div class="field">
				<span class="cap" aria-hidden="true">出發</span>
				<input aria-label="出發" bind:value={departText} placeholder={current.depart ? '' : '每人不一樣'} />
			</div>
			<div class="field">
				<span class="cap" aria-hidden="true">到達</span>
				<input aria-label="到達" bind:value={arriveText} placeholder={current.arrive ? '' : '每人不一樣'} />
			</div>
		</div>
		<small class="muted">這一段打「2-5」，口號段打秒數；別的段前面加段名，例：口號 1 12.3</small>
		<div class="buttons">
			<button type="button" class="primary" onclick={apply}>套用</button>
			<button type="button" onclick={useDefault} title="清掉設定：最後一個八拍才走">用預設</button>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
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
