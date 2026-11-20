<script lang="ts">
	// 左邊欄規則警告的撞位、走太快、很喘總表：寫各幾個，點開是清單，每行寫哪一拍、誰和誰；
	// 點一行播放頭跳到那一拍（撞位是兩人最近那一刻，走位是到達），選好那幾個人。
	// 撞位用頁面算好的那一份，走太快、很喘用 formationWalks，不另外算。都沒有就不出現。
	import { formationWalks, memberName, positionWhy, type Clash, type Flow } from '#lib/core';
	import { joinText, whyText } from '#lib/reason-text.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getEditor } from '#lib/editor.svelte.js';
	import Icon from './Icon.svelte';

	interface Props {
		flow: Flow;
		clashes: Clash[];
	}
	let { flow, clashes }: Props = $props();

	const { session, playback } = getEditor();
	let open = $state(false);

	interface Row {
		kind: 'clash' | 'fast' | 'tiring';
		sec: number;
		memberIds: string[];
	}

	const KIND_LABELS: Record<Row['kind'], () => string> = {
		clash: m.timeline_clash,
		fast: m.timeline_too_fast,
		tiring: m.timeline_tiring
	};

	const rows = $derived.by(() => {
		const out: Row[] = clashes.map((c) => ({ kind: 'clash', sec: c.sec, memberIds: [...c.memberIds] }));
		for (const f of flow.formations.slice(1)) {
			for (const w of formationWalks(flow, f.id)) {
				if (w.tooFast || w.tiring)
					out.push({ kind: w.tooFast ? 'fast' : 'tiring', sec: w.arriveSec, memberIds: [w.memberId] });
			}
		}
		return out.sort((a, b) => a.sec - b.sec);
	});
	const count = (kind: Row['kind']) => rows.filter((r) => r.kind === kind).length;

	/** 誰和誰：「小A、小B」（英文用逗號）。 */
	const names = (ids: string[]) => joinText(ids.map((id) => memberName(flow, id)));

	function go(r: Row) {
		playback.seek(r.sec);
		session.selectMembers(r.memberIds);
	}
</script>

{#if rows.length}
	<div class="summary">
		<button type="button" class="head" aria-expanded={open} onclick={() => (open = !open)}
			><Icon name="warn" /><b>{m.timeline_rule_counts({ clash: count('clash'), fast: count('fast'), tiring: count('tiring') })}</b></button
		>
		{#if open}
			<ul aria-label={m.timeline_rule_list()}>
				{#each rows as r, i (i)}
					<li>
						<button type="button" onclick={() => go(r)}
							><span class="at">{whyText(positionWhy(flow, r.sec))}</span>{' '}<b class:clash={r.kind === 'clash'}>{KIND_LABELS[r.kind]()}</b>{' '}<span
								>{names(r.memberIds)}</span
							></button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.summary {
		border-radius: 10px;
		background: var(--warn-bg);
		border: 1px solid #f0d488;
		color: var(--warn-text);
		font-size: 12px;
		font-weight: 500;
	}
	button {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		width: 100%;
		padding: 4px 12px;
		border: 0;
		border-radius: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	button:hover {
		text-decoration: underline;
	}
	.head {
		padding-block: 8px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 4px;
		max-height: 240px;
		overflow-y: auto;
	}
	li {
		border-top: 1px solid #f0d488;
	}
	li button {
		flex-wrap: wrap;
		/* 觸控時按鈕至少 40px 高：字放在上下中間，不貼上緣（N32） */
		align-content: center;
		gap: 0 4px;
	}
	.at {
		font-variant-numeric: tabular-nums;
	}
	li b {
		font-weight: 700;
	}
	.clash {
		color: var(--walk-clash, #a855f7);
	}
</style>
