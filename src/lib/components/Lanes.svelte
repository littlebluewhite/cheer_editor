<script lang="ts">
	// 泳道：一人一條，照名單順序。動作是色條（顏色照大類，寫那個人的任務角色），
	// 沒在動作裡的時間是灰條紋；播放頭那一拍閒著的人名字變灰、標「閒」。
	import { actionLabel, actionSeconds, idleAt, totalSeconds, type Flow } from '#lib/core';
	import { CATEGORY_COLORS } from './category-colors';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
		selectedActionId: string | null;
		onselectaction: (actionId: string) => void;
	}

	let { flow, playheadSec, pxPerSec, selectedActionId, onselectaction }: Props = $props();

	const width = $derived(totalSeconds(flow) * pxPerSec);
	const idle = $derived(new Set(idleAt(flow, playheadSec)));
	/** 每個動作的位置（px），一個動作算一次，泳道共用。 */
	const placed = $derived(
		flow.actions.map((action) => {
			const { startSec, endSec } = actionSeconds(flow, action);
			return {
				action,
				label: actionLabel(action),
				left: startSec * pxPerSec,
				width: (endSec - startSec) * pxPerSec
			};
		})
	);
</script>

{#each flow.members as m, i (m.id)}
	<div class="row" data-lane={m.id}>
		<div class="lab" class:idle={idle.has(m.id)}>
			<b>{i + 1}</b>
			<span class="name">{m.name}</span>
			<i class="gr {m.globalRole}">{m.globalRole === 'top' ? '上' : '底'}</i>
			{#if idle.has(m.id)}<span class="idle-tag">閒</span>{/if}
		</div>
		<div class="trk" style:width={`${width}px`}>
			{#each placed as p (p.action.id)}
				{@const member = p.action.members.find((x) => x.memberId === m.id)}
				{#if member}
					<button
						type="button"
						class="bar"
						class:selected={p.action.id === selectedActionId}
						data-action-id={p.action.id}
						style:left={`${p.left}px`}
						style:width={`${p.width}px`}
						style:background={CATEGORY_COLORS[p.action.category]}
						title="{p.label}{member.role ? `（${member.role}）` : ''}"
						onclick={() => onselectaction(p.action.id)}
					>
						{#if p.action.members[0].memberId === m.id}<b>{p.label}</b>{/if}
						{member.role ?? ''}
					</button>
				{/if}
			{/each}
		</div>
	</div>
{/each}

<style>
	.row {
		display: flex;
		height: 16px;
		border-bottom: 1px solid #f0f1f5;
	}
	.lab {
		position: sticky;
		left: 0;
		z-index: 3;
		width: 120px;
		flex: none;
		box-sizing: border-box;
		background: #fafbfd;
		border-right: 1px solid #dde1ea;
		padding: 0 4px;
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
		overflow: hidden;
	}
	.lab b {
		color: #6b7280;
		font-weight: 600;
	}
	.lab.idle .name {
		color: #9aa1b2;
	}
	.idle-tag {
		color: #9aa1b2;
		font-style: italic;
	}
	.gr {
		font-style: normal;
		font-size: 9px;
		color: #fff;
		border-radius: 3px;
		padding: 0 3px;
	}
	.gr.base {
		background: #2c3e66;
	}
	.gr.top {
		background: #e0664f;
	}
	/* 灰條紋 = 沒在動作裡（站著或走位）；色條蓋在上面。 */
	.trk {
		position: relative;
		flex: none;
		height: 100%;
		background: repeating-linear-gradient(90deg, transparent 0 6px, #eceef3 6px 7px);
	}
	.bar {
		position: absolute;
		top: 1px;
		bottom: 1px;
		border: none;
		border-radius: 3px;
		color: #fff;
		font: inherit;
		font-size: 10px;
		line-height: 13px;
		padding: 0 4px;
		text-align: left;
		overflow: hidden;
		white-space: nowrap;
		cursor: pointer;
		opacity: 0.88;
	}
	.bar.selected {
		outline: 2px solid #1d2330;
		opacity: 1;
	}
</style>
