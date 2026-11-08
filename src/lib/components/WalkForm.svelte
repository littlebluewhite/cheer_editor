<script lang="ts">
	// 出發和到達：播放頭停在站位上（不是開頭那張）時，替選到的人（沒選人就是全隊有走位的人）設走到這張的出發和到達。
	// 在出發或到達按 Enter 就套用（選字中的 Enter 不算）。旁邊寫走位速度（太快寫至少要幾拍）；選到的人這段都沒走位就寫「這段沒有走位」、不能套用。
	// 時間的寫法照流程核心：這一段只打段內時間，別的段前面加段名。規則都交給流程核心判斷；被擋就說原因。
	import { composing } from '#lib/ime.js';
	import { untrack } from 'svelte';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		clearWalks,
		formationWalks,
		memberWalk,
		readTime,
		setTeamWalks,
		setWalks,
		timeExamples,
		timeText,
		walkSpanAt,
		walkSpeedText,
		type Walk
	} from '#lib/core';

	const session = getEditorSession();
	/** 播放頭（全域秒數）從編輯器 module 的播放拿。 */
	const { playback } = getEditor();
	const flow = $derived(session.flow!);
	/** 選到的人；沒選人就是全隊。 */
	const selectedMemberIds = $derived(session.selectedMemberIds);

	const formation = $derived.by(() => {
		const span = walkSpanAt(flow, playback.sec);
		return span?.on ? span.to : null;
	});
	/** 改誰：選到的人；沒選人是全隊有走位的人（兩張站位位置不同的人，站著不動的不寫）。 */
	const memberIds = $derived(
		selectedMemberIds.length
			? selectedMemberIds
			: formation
				? formationWalks(flow, formation.id).map((w) => w.memberId)
				: []
	);
	/** 改的人裡面這段真的有走位的（位置有變）。 */
	const moving = $derived(
		formation ? formationWalks(flow, formation.id).filter((w) => memberIds.includes(w.memberId)) : []
	);
	/** 選到的人這段都站著不動：沒有走位可以設。 */
	const noWalk = $derived(memberIds.length > 0 && moving.length === 0);
	/** 速度：只有一個人走位時寫他的速度；好幾個人時只寫太快和很喘的人（前面加名字）。 */
	const speedLines = $derived(
		moving.length === 1
			? [walkSpeedText(flow, moving[0])]
			: moving
					.filter((w) => w.tooFast || w.tiring)
					.map((w) => `${flow.members.find((m) => m.id === w.memberId)?.name ?? ''}　${walkSpeedText(flow, w)}`)
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

	/** 欄位下面的寫法說明：這一段怎麼打、別的段加段名，例子照這支流程真的有的段。 */
	const howTo = $derived.by(() => {
		if (!formation) return '';
		const home = formation.segmentId!;
		const { here, other } = timeExamples(flow, home);
		const unit = flow.segments.find((s) => s.id === home)?.kind === 'chant' ? '秒數' : '八拍-拍';
		return `這一段打${unit}，例：${here}${other ? `；別的段前面加段名，例：${other}` : ''}`;
	});

	let departText = $state('');
	let arriveText = $state('');
	/** 被擋的原因（出發、到達看不懂也算）。 */
	const ask = session.changeAsk();

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
		{#if noWalk}
			<p class="no-walk">這段沒有走位</p>
		{:else}
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
			{#if speedLines.length}
				<p class="speed" aria-label="走位速度">
					{#each speedLines as line, i (i)}<span>{line}</span>{/each}
				</p>
			{/if}
			<small class="muted">{howTo}</small>
		{/if}
		<div class="buttons">
			<button type="button" class="primary" disabled={noWalk} onclick={apply}>套用</button>
			<button type="button" disabled={noWalk} onclick={useDefault} title="清掉設定：最後一個八拍才出發">用預設</button>
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
	.speed {
		display: grid;
		gap: 2px;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.no-walk {
		color: var(--muted, #66718a);
	}
</style>
