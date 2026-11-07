<script lang="ts">
	// 站位小編輯（場地左欄、圖例上面）：拖人會改哪一張、播放頭所在站位的名稱和站位時間、跟上一張一樣（在最下面，位置固定）。
	// 規則都交給流程核心判斷；被擋就說原因。
	import { composing } from '#lib/ime.js';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		formationAt,
		matchPrevious,
		moveFormation,
		moveFormationHint,
		moveTargetText,
		readTime,
		renameFormation,
		timeText,
		type TimePosition
	} from '#lib/core';
	import CharCount from './CharCount.svelte';

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 改名、站位時間看不懂：被擋的原因放進提示；成功不收掉別的提示，也不動場上的問題。 */
	const ask = session.changeAsk({ onfail: (error) => (session.notice = error) });
	/** 播放頭（全域秒數）從編輯器 module 的播放拿。 */
	const { playback } = getEditor();

	const match = $derived(matchPrevious(flow, playback.sec, session.selectedMemberIds));
	const matchBlocked = $derived(match.kind === 'blocked' ? match.message : '');
	const here = $derived(formationAt(flow, playback.sec));
	let nameInput = $state<HTMLInputElement>();
	// 開頭那張還沒有段時 segmentId 是 null，框裡就空著（反正不能挪）。
	const hereTime = $derived(here?.segmentId ? timeText(flow, here.segmentId, here as TimePosition) : '');

	/** ① 跟上一張一樣：選到的人改成上一張站位的位置（沒有站位就先插一張），提示和播放頭跟拖人一樣。 */
	function matchPrev() {
		const f = flow;
		const sec = playback.sec;
		const ids = session.selectedMemberIds;
		session.ask.send(() => matchPrevious(f, sec, ids), { done: (r) => session.moved(r) });
	}

	/** 幫播放頭所在的站位取名；名字沒變就不記一步復原。站位已經刪掉了（名稱框跟著被拿掉時才送出）就不改。 */
	function renameHere(formationId: string, name: string) {
		const formation = flow.formations.find((f) => f.id === formationId);
		if (!formation || name.trim() === (formation.name ?? '')) return;
		ask.send(() => renameFormation(flow, formationId, name));
	}

	/**
	 * 「站位時間」框改了：寫法跟出發、到達一樣，看得懂就挪過去。
	 * 框先變回原本的 text：挪成功時跟著流程換成新的站位時間，看不懂或被擋就留在原本的。
	 * 站位已經刪掉了（框跟著被拿掉時才送出）就不挪。
	 */
	function retimeHere(box: HTMLInputElement, formationId: string, text: string) {
		const formation = flow.formations.find((f) => f.id === formationId);
		if (!formation) return;
		// 播放頭停在這張上、框能打字，表示不是開頭那張，一定有段。
		const to = readTime(flow, formation.segmentId!, box.value, '站位時間');
		box.value = text;
		if (to.kind === 'blocked') return void ask.send(() => to);
		const f = flow;
		session.ask.send(() => moveFormation(f, formation.id, to.value), {
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

<div class="here" class:on={!!here}>
	<p class="move-target">{moveTargetText(flow, playback.sec)}</p>
	{#if here}
		{#key here.id}
			<div class="name-row">
				<input
					class="formation-name"
					aria-label="站位名稱"
					placeholder="幫這張站位取名（可不填）"
					value={here.name ?? ''}
					bind:this={nameInput}
					data-id={here.id}
					onkeydown={(e) => boxKeydown(e, here.name ?? '')}
					onchange={(e) => renameHere(e.currentTarget.dataset.id!, e.currentTarget.value)}
				/>
				<CharCount field="formationName" input={nameInput} value={here.name ?? ''} />
			</div>
			<label class="formation-time">
				<span>站位時間</span>
				<input
					value={hereTime}
					disabled={here === flow.formations[0]}
					data-id={here.id}
					onkeydown={(e) => boxKeydown(e, hereTime)}
					onchange={(e) => retimeHere(e.currentTarget, e.currentTarget.dataset.id!, hereTime)}
				/>
			</label>
			<p class="time-hint">{moveFormationHint(flow, here.id)}</p>
		{/key}
	{/if}
</div>
<!-- 放在卡片下面：左欄下面這一塊貼著底，卡片變高變矮時按鈕不會跳；說明字那一行一直留著，有沒有字都一樣高 -->
<div class="match-prev">
	<button type="button" disabled={!!matchBlocked} onclick={matchPrev}>跟上一張一樣</button>
	<span class="why">{matchBlocked}</span>
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
	.name-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.formation-name {
		flex: 1;
		min-width: 0;
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
	/* 拖人之前的提示：會改哪一張站位，還是會插一張新的。沒有框的灰色小字，不像按鈕。 */
	.move-target {
		margin: 0;
		padding: 0 2px;
		color: var(--muted);
		font-size: 12px;
		pointer-events: none;
	}
	/* ① 跟上一張一樣：在站位卡片下面，按鈕位置固定；按不下去的原因寫在下面那一行。 */
	.match-prev {
		display: grid;
		justify-items: start;
		gap: 2px;
		font-size: 12px;
		color: var(--muted);
	}
	.match-prev .why {
		min-height: 1.4em;
		line-height: 1.4;
		padding: 0 2px;
	}
</style>
