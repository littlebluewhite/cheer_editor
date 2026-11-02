<script lang="ts">
	// 選人：一鍵選全隊、全部底層、全部上層、這一拍沒在動作裡的人、清除；
	// 「沿用上一個動作的人」取播放頭以前最晚結束的動作，再按一次換更早的。
	// 選到的人是在播放頭新增動作的人，也是場上整組拖的那一組。
	import {
		actionLabel,
		memberGroup,
		memberName,
		previousActions,
		type Flow,
		type MemberGroup
	} from '#lib/core';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		selected: string[];
		onselect: (memberIds: string[]) => void;
	}

	let { flow, playheadSec, selected, onselect }: Props = $props();

	const GROUPS: { group: MemberGroup; label: string }[] = [
		{ group: 'all', label: '全隊' },
		{ group: 'base', label: '全部底層' },
		{ group: 'top', label: '全部上層' },
		{ group: 'idle', label: '這一拍沒在動作裡的人' }
	];

	/** 「沿用上一個動作的人」這次要拿第幾個候選；播放頭一動就從最晚結束的重來。 */
	let cycle = { sec: NaN, index: 0 };
	let message = $state('');

	const names = $derived(selected.map((id) => memberName(flow, id)).filter(Boolean));

	function previous() {
		const candidates = previousActions(flow, playheadSec);
		if (candidates.length === 0) {
			message = '播放頭前面還沒有動作';
			return;
		}
		if (cycle.sec !== playheadSec) cycle = { sec: playheadSec, index: 0 };
		const action = candidates[cycle.index % candidates.length];
		cycle.index += 1;
		onselect(action.members.map((m) => m.memberId));
		const more = candidates.length > 1 ? '（再按一次換更早的動作）' : '';
		message = `選了「${actionLabel(action)}」的 ${action.members.length} 人${more}`;
	}
</script>

<section class="picker">
	<header>
		<h3>選人</h3>
		{#if names.length}<button type="button" class="link" onclick={() => onselect([])}>清除</button>{/if}
	</header>
	<div class="chips">
		{#each GROUPS as g (g.group)}
			<button type="button" onclick={() => onselect(memberGroup(flow, g.group, playheadSec))}
				>{g.label}</button
			>
		{/each}
		<button type="button" onclick={previous}>沿用上一個動作的人</button>
	</div>
	{#if message}<p class="muted" role="status">{message}</p>{/if}
	<p class="picked" class:none={!names.length}>已選 {names.length} 人{names.length ? `：${names.join('、')}` : ''}</p>
	<p class="muted">場上點人、Shift＋點多選、拖空白處框選；或點泳道上的名字。</p>
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
