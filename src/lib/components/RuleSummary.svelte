<script lang="ts">
	// 左邊欄規則警告的撞位、走太快、很喘總表：寫各幾個，點開是清單，每行寫哪一拍、誰和誰；
	// 點一行播放頭跳到那一拍（撞位是兩人最近那一刻，走位是到達），選好那幾個人。
	// 撞位用頁面算好的那一份，走太快、很喘用 formationWalks，不另外算。都沒有就不出現。
	import { formationWalks, memberName, positionText, type Clash, type Flow } from '#lib/core';
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
		kind: '撞位' | '走太快' | '很喘';
		sec: number;
		memberIds: string[];
	}

	const rows = $derived.by(() => {
		const out: Row[] = clashes.map((c) => ({ kind: '撞位', sec: c.sec, memberIds: [...c.memberIds] }));
		for (const f of flow.formations.slice(1)) {
			for (const w of formationWalks(flow, f.id)) {
				if (w.tooFast || w.tiring)
					out.push({ kind: w.tooFast ? '走太快' : '很喘', sec: w.arriveSec, memberIds: [w.memberId] });
			}
		}
		return out.sort((a, b) => a.sec - b.sec);
	});
	const count = (kind: Row['kind']) => rows.filter((r) => r.kind === kind).length;

	function go(r: Row) {
		playback.seek(r.sec);
		session.selectMembers(r.memberIds);
	}
</script>

{#if rows.length}
	<div class="summary">
		<button type="button" class="head" aria-expanded={open} onclick={() => (open = !open)}
			><Icon name="warn" /><b>撞位 {count('撞位')}・走太快 {count('走太快')}・很喘 {count('很喘')}</b></button
		>
		{#if open}
			<ul aria-label="撞位、走太快、很喘">
				{#each rows as r, i (i)}
					<li>
						<button type="button" onclick={() => go(r)}
							><span class="at">{positionText(flow, r.sec)}</span>{' '}<b class:clash={r.kind === '撞位'}>{r.kind}</b>{' '}<span
								>{r.memberIds.map((id) => memberName(flow, id)).join('、')}</span
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
