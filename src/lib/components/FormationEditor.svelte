<script lang="ts">
	// 站位小編輯（場地左欄、圖例上面）：跟上一張一樣、拖人會改哪一張、播放頭所在站位的名稱和站位時間。
	// 規則都交給流程核心判斷；被擋就說原因。
	import { composing } from '#lib/ime.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		formationAt,
		matchPrevious,
		moveFormation,
		moveFormationHint,
		moveTargetText,
		parseTime,
		renameFormation,
		timeText,
		type Formation,
		type TimePosition
	} from '#lib/core';

	interface Props {
		/** 播放頭，全域秒數。 */
		playheadSec: number;
	}

	let { playheadSec }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	const match = $derived(matchPrevious(flow, playheadSec, session.selectedMemberIds));
	const matchBlocked = $derived(match.kind === 'blocked' ? match.message : '');
	const here = $derived(formationAt(flow, playheadSec));
	// 開頭那張還沒有段時 segmentId 是 null，框裡就空著（反正不能挪）。
	const hereTime = $derived(here?.segmentId ? timeText(flow, here.segmentId, here as TimePosition) : '');

	/** ① 跟上一張一樣：選到的人改成上一張站位的位置（沒有站位就先插一張），提示和播放頭跟拖人一樣。 */
	function matchPrev() {
		const f = flow;
		const sec = playheadSec;
		const ids = session.selectedMemberIds;
		session.ask.send(() => matchPrevious(f, sec, ids), { done: (r) => session.moved(r) });
	}

	/** 幫播放頭所在的站位取名；名字沒變就不記一步復原。 */
	function renameHere(formationId: string, name: string) {
		const before = flow.formations.find((f) => f.id === formationId)?.name ?? '';
		if (name.trim() === before) return;
		const r = renameFormation(flow, formationId, name);
		if (r.kind !== 'ok') return void (session.notice = r.message);
		session.change(r.flow);
	}

	/**
	 * 「站位時間」框改了：寫法跟出發、到達一樣，看得懂就挪過去。
	 * 框先變回原本的 text：挪成功時跟著流程換成新的站位時間，看不懂或被擋就留在原本的。
	 */
	function retimeHere(box: HTMLInputElement, formation: Formation, text: string) {
		// 播放頭停在這張上、框能打字，表示不是開頭那張，一定有段。
		const to = parseTime(flow, formation.segmentId!, box.value);
		box.value = text;
		if (!to) return void (session.notice = '站位時間看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）');
		const f = flow;
		session.ask.send(() => moveFormation(f, formation.id, to), {
			revert: () => {},
			done: (r) => session.formationMoved(formation.id, r)
		});
	}

	/**
	 * 名稱框、站位時間框的按鍵：Enter 離開框（送出），Esc 變回 original 再離開。
	 * 中文輸入法還在選字時按的 Enter / Esc 是給輸入法的；這時離開輸入框，字會重複（Safari 選字時 keyCode 是 229）。
	 */
	function boxKeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }, original: string) {
		if (composing(e)) return;
		if (e.key === 'Enter') e.currentTarget.blur();
		if (e.key === 'Escape') {
			e.currentTarget.value = original;
			e.currentTarget.blur();
		}
	}
</script>

<div class="match-prev">
	<button type="button" disabled={!!matchBlocked} onclick={matchPrev}>跟上一張一樣</button>
	{#if matchBlocked}<span>{matchBlocked}</span>{/if}
</div>
<div class="here" class:on={!!here}>
	<p class="move-target">{moveTargetText(flow, playheadSec)}</p>
	{#if here}
		{#key here.id}
			<input
				class="formation-name"
				aria-label="站位名稱"
				placeholder="幫這張站位取名（可不填）"
				value={here.name ?? ''}
				onkeydown={(e) => boxKeydown(e, here.name ?? '')}
				onchange={(e) => renameHere(here.id, e.currentTarget.value)}
			/>
			<label class="formation-time">
				<span>站位時間</span>
				<input
					value={hereTime}
					disabled={here === flow.formations[0]}
					onkeydown={(e) => boxKeydown(e, hereTime)}
					onchange={(e) => retimeHere(e.currentTarget, here, hereTime)}
				/>
			</label>
			<p class="time-hint">{moveFormationHint(flow, here.id)}</p>
		{/key}
	{/if}
</div>

<style>
	/* 播放頭停在站位上：「拖人會改」那行和站位名稱合成一張卡。 */
	.here.on {
		align-self: stretch;
		display: grid;
		gap: 6px;
		padding: 8px;
		border-radius: 10px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-left: 4px solid var(--sel, #19b4d8);
	}
	.here.on .move-target {
		padding: 0 2px;
	}
	.formation-name {
		width: 100%;
		font-size: 14px;
		font-weight: 600;
	}
	/* 站位時間：小標在左、拍子框在右；下面一行寫能挪到哪。 */
	.formation-time {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 2px;
		font-size: 12px;
		color: var(--muted);
	}
	.formation-time input {
		width: 96px;
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	/* 開頭那張不能挪：框變灰。 */
	.formation-time input:disabled {
		background: var(--surface-2);
		border-color: var(--line-soft);
		color: var(--muted);
	}
	.time-hint {
		margin: -2px 0 0;
		padding: 0 2px;
		font-size: 11px;
		line-height: 1.4;
		color: var(--muted);
	}
	/* 拖人之前的提示：會改哪一張站位，還是會插一張新的。 */
	.move-target {
		margin: 0;
		padding: 4px 10px;
		border-radius: 8px;
		background: var(--surface, #fff);
		color: var(--muted);
		font-size: 12px;
		pointer-events: none;
	}
	/* ① 跟上一張一樣：在「拖人會改」那一行上面。 */
	.match-prev {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--muted);
	}
	.match-prev span {
		padding: 4px 10px;
		border-radius: 8px;
		background: var(--surface, #fff);
	}
</style>
