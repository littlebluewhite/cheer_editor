<script lang="ts">
	import {
		currentFormation,
		clashes,
		formationWalks,
		memberMarkers,
		positionText,
		positionsAt,
		raisedAt,
		squadBadge,
		timeRuleWarnings,
		stackedMembers,
		totalSeconds,
		walkSpanAt,
		type Flow,
		type Clash,
		type FormationWalk,
		type Position
	} from '#lib/core';
	import { browserAdapters, Editor, setEditor } from '#lib/editor.svelte.js';
	import { draftTime, type RecentFlow } from '#lib/flow-file.svelte.js';
	import { flushSync, onMount, type ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';
	import { MAX_LATENCY_MS } from '#lib/local-settings.js';
	import { autoInspectorWidth, clampInspectorWidth, INSPECTOR_MIN_PX } from '#lib/editor-layout.js';
	import { Divider } from '#lib/divider.svelte.js';
	import { setUnsavedCheck } from '#lib/unsaved.js';
	import { localDate } from '#lib/local-date.js';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import ConfirmList from '#lib/components/ConfirmList.svelte';
	import type CueGrid from '#lib/components/CueGrid.svelte';
	import CueOverlay from '#lib/components/CueOverlay.svelte';
	import Field, { fullView } from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import FormationEditor from '#lib/components/FormationEditor.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { modalOpen } from '#lib/components/Modal.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import MemberPicker from '#lib/components/MemberPicker.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';
	import Practice from '#lib/components/Practice.svelte';
	import PrintSheet from '#lib/components/PrintSheet.svelte';
	import SegmentSettings from '#lib/components/SegmentSettings.svelte';
	import SquadBar from '#lib/components/SquadBar.svelte';
	import Timeline from '#lib/components/Timeline.svelte';
	import WalkForm from '#lib/components/WalkForm.svelte';

	interface Props {
		/**
		 * 編輯器 module（編輯頁的狀態和碰瀏覽器的 adapter）；測試放一個帶好流程、adapter 都是假的進來
		 * （#lib/test-fakes.js 的 editorPage），再讀它的 session。沒給就用真的 adapter 自己建。
		 */
		editor?: Editor;
		// 螢幕座標換算（ADR 0002）：預設用瀏覽器算；jsdom 不算版面，測試換成假的。往下傳給場地、拍點格子、段設定的波形。
		/** 場地：指標位置換成場地公尺。 */
		toMeters?: ComponentProps<typeof Field>['toMeters'];
		/** 拍點格子：指標位置對到的格子。 */
		cellAt?: ComponentProps<typeof CueGrid>['cellAt'];
		/** 段設定的波形：滑鼠位置換成音樂檔的秒數。 */
		waveXToSec?: ComponentProps<typeof SegmentSettings>['waveXToSec'];
	}

	let { editor: given, toMeters, cellAt, waveXToSec }: Props = $props();
	// 編輯器 module 一開始給了就不換：放進 context 的就是這一個。
	// svelte-ignore state_referenced_locally
	const editor = given ?? new Editor(browserAdapters());
	setEditor(editor);
	const { session, playback } = editor;
	// ⌘Z 前後送出沒送出的字：用編輯器 module 收著的 adapter。
	const { pendingInput } = editor.adapters;

	/** 使用說明開在新分頁：編輯畫面留著，還沒存的修改不會因為看說明而不見。 */
	const guideHref = resolve('/guide');

	const flow = $derived(session.flow);
	const unsaved = $derived(session.unsaved);
	// 新版 service worker 要自動重新載入前先看這個（src/hooks.client.ts）。
	setUnsavedCheck(() => editor.hasUnsavedWork);
	/**
	 * 有還沒存的修改、欄位裡打了字還沒送出時關分頁、重新整理：讓瀏覽器先問
	 * （草稿要停手 1 秒才存，最後的修改可能還沒進草稿）。
	 */
	function onbeforeunload(e: BeforeUnloadEvent) {
		if (editor.hasUnsavedWork) e.preventDefault();
	}
	// 草稿：頁面打開了才讀、才開分頁頻道，關掉時停。
	onMount(() => editor.file.connect());

	let openSegmentId = $state<string | null>(null);
	let settingsOpen = $state(false);
	/** 八拍表列印畫面開著：印的時候只印它，不印編輯畫面。 */
	let printOpen = $state(false);
	/** 觸控螢幕（iPad）：沒有 Shift、Esc，場地左邊才放「多選」「取消選取」（docs/adr/0005-ipad-touch.md）。 */
	const touchScreen = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	/** 選到的動作有環節、要分組（騰翻、跳躍以外）：場上出現組號小圓和分組浮動列。 */
	const groupingAction = $derived(session.groupingAction);
	/** 組號小圓：動作的人寫組號、塗組色；沒分組是灰色「?」。 */
	const squadBadges = $derived(
		Object.fromEntries((groupingAction?.members ?? []).map((m) => [m.memberId, squadBadge(groupingAction!, m)]))
	);
	/** 主畫面：編排（場地、右邊欄、時間軸）或練習（記成功率）。練習時編排的東西藏起來（不拆掉，場地、時間軸的縮放還在）。 */
	let view = $state<'edit' | 'practice'>('edit');
	/** 練習記在哪一天：預設今天，可以改（練完補打）；切換編排、練習時留著，不存進流程檔。 */
	let practiceDate = $state(localDate());
	/** 第幾份打開的流程（開檔、新建、救回草稿各算一次）；練習畫面照這個重開。 */
	let opened = $state(0);
	/** 首頁按了「丟掉」的那支最近的流程：先問。 */
	let discarding = $state.raw<RecentFlow | null>(null);

	/** 切到編排或練習。練習時不放音樂，先停下來。 */
	function setView(next: 'edit' | 'practice') {
		if (next === 'practice') playback.pause();
		view = next;
	}

	/** 整個流程的撞位；只跟著流程重算，播放頭動不用重算。場地和泳道共用這一份。 */
	const allClashes = $derived(flow ? clashes(flow) : []);

	/**
	 * 場上的影子、走位線和撞位：播放頭在站位 B 上（不是開頭那張）畫上一張的影子和這段的走位線、撞位；
	 * 在兩張站位中間只畫這段的走位線和撞位；開頭那張、最後一張之後都不畫。
	 */
	const trail = $derived.by(() => {
		const none = { ghosts: {} as Record<string, Position>, walks: [] as FormationWalk[], clashes: [] as Clash[] };
		if (!flow) return none;
		const span = walkSpanAt(flow, playback.sec);
		if (!span) return none;
		return {
			ghosts: span.on ? span.from.pos : none.ghosts,
			walks: formationWalks(flow, span.to.id),
			clashes: allClashes.filter((c) => c.formationId === span.to.id)
		};
	});

	/** 播放頭的位置拆成段名和段內位置，上方列分開排大小字。 */
	const position = $derived.by(() => {
		const text = flow ? positionText(flow, playback.sec) : '';
		const cut = text.indexOf(' ', text.indexOf(' ') + 1);
		return cut === -1 ? null : { segment: text.slice(0, cut), at: text.slice(cut + 1) };
	});

	/** 秒數寫成「1:05.3」。 */
	function clock(sec: number): string {
		const m = Math.floor(sec / 60);
		const s = (sec - m * 60).toFixed(1).padStart(4, '0');
		return `${m}:${s}`;
	}

	// ---------- 場地和時間軸的分界：拖它（或 ↑↓）改時間軸多高，存在這台電腦；雙擊回到預設 ----------
	const TIMELINE_MIN_PX = 160;
	/** 場地和上方列至少留這麼高。 */
	const FIELD_KEEP_PX = 300;
	let timelineHost = $state<HTMLElement>();
	const timelineDivider = new Divider({
		name: 'timelineHeightPx',
		axis: 'y',
		clamp: (px) => Math.round(Math.min(Math.max(px, TIMELINE_MIN_PX), window.innerHeight - FIELD_KEEP_PX)),
		size: currentTimelineH
	});

	/** 時間軸現在多高：拖過就是拖的高度，沒拖過量畫面（量不到用預設的 30vh）。 */
	function currentTimelineH(): number {
		if (timelineDivider.px !== null) return timelineDivider.px;
		return Math.round(timelineHost?.getBoundingClientRect().height || Math.max(200, window.innerHeight * 0.3));
	}

	// ---------- 場地和右邊欄的分界：沒拖過時自動分（場地吃得到的寬度給場地，剩下給右邊欄）；
	// 拖它（或 ←→）自己定寬度，存在這台電腦；雙擊回到自動 ----------
	let windowW = $state(0);
	let fieldHostH = $state(0);
	const inspectorDivider = new Divider({
		name: 'inspectorWidthPx',
		axis: 'x',
		clamp: (px) => clampInspectorWidth(px, window.innerWidth),
		size: (): number => inspectorPx
	});

	const fieldAspect = $derived.by(() => {
		if (!flow) return 1;
		const v = fullView(flow.field);
		return v.width / v.height;
	});
	/** 右邊欄現在多寬。 */
	const inspectorPx = $derived(
		inspectorDivider.px === null
			? autoInspectorWidth(windowW, fieldHostH, fieldAspect)
			: clampInspectorWidth(inspectorDivider.px, windowW)
	);

	/** 量場地那一欄多高（視窗或時間軸變了就重量）。jsdom 沒有 ResizeObserver，測試裡就不量。 */
	function watchFieldHostH(el: HTMLElement) {
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => (fieldHostH = el.clientHeight));
		ro.observe(el);
		return () => ro.disconnect();
	}


	// 換成另一支流程（新建、開檔、救回草稿）：練習畫面重開、對話框都關掉。
	// 換上流程由編輯器 module 的流程檔做；選取、提示由 session 清掉，播放停下、回到開頭由播放做（session.open 叫它）。
	editor.file.onswitch = () => {
		opened++;
		openSegmentId = null;
		settingsOpen = false;
		printOpen = false;
	};

	function undo() {
		if (session.undo()) restore(session.flow!);
	}

	function redo() {
		if (session.redo()) restore(session.flow!);
	}

	/** 復原、重做換上的流程：開著的段設定可能指到已經不在的段（選取、提示、播放頭由 session、播放處理）。 */
	function restore(f: Flow) {
		if (openSegmentId && !f.segments.some((s) => s.id === openSegmentId)) {
			playback.stopPreview();
			openSegmentId = null;
		}
	}

	/** 開檔：選檔欄位（Safari、iPad、Firefox）。 */
	function open(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void editor.file.open(file);
	}

	/** 開檔：Chrome、Edge 不跳選檔欄位，改用選檔視窗。 */
	function pickOpen(e: Event) {
		if (!editor.file.canPick) return;
		e.preventDefault();
		void editor.file.pick();
	}

	/** 段設定、流程設定、八拍表、「還沒存」的問題蓋在上面：底下的編輯畫面點不到、Tab 不到，快捷鍵也不動它。 */
	const overlayOpen = $derived(!!openSegmentId || settingsOpen || printOpen || editor.file.asking);
	/** 有東西蓋在上面（上面那些，或表單裡打開的名詞對照表這種對話框）：快捷鍵不動底下的編輯畫面。 */
	const covered = () => overlayOpen || modalOpen();

	/** 下一個操作（按下滑鼠、手指、鍵盤）就收掉提示泡泡；按在泡泡上（「復原」、✕）不算。先收，操作自己的提示才放得上去。 */
	function dismissNotice(e: Event) {
		if (session.notice && !(e.target as Element | null)?.closest?.('.toast')) session.notice = '';
	}

	/** 空白鍵照瀏覽器原本的行為的東西：按得下去、選得了、打得了字的。場上的人不算（空白鍵播放）。 */
	const NATIVE_KEYS =
		'button, a[href], input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), ' +
		'[role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"], [role="menuitem"]';
	/** 打字的地方：快捷鍵（Delete、方向鍵、Home／End、數字鍵）留給它。 */
	const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

	/** 復原、重做：焦點在輸入框裡時，先把打了還沒送出的字送出去，再退回流程，欄位照退回的流程重畫。 */
	function undoKey(redoing: boolean) {
		pendingInput.flush();
		flushSync();
		if (redoing) redo();
		else undo();
		flushSync();
		pendingInput.settle();
	}

	function onkeydown(e: KeyboardEvent) {
		// Ctrl+S（Mac ⌘S）在輸入框裡也要能存，所以放在最前面；也擋掉瀏覽器的「另存網頁」。
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void editor.file.save();
			return;
		}
		if (!flow) return;
		// 練習時只留存檔：空白鍵留給記號按鈕，Delete 不能刪到藏起來的動作、站位；
		// 復原、重做只退編排的修改，在練習畫面看不到退了什麼，還可能弄掉紀錄
		if (view === 'practice') return;
		const target = e.target as Element | null;
		const on = (selector: string) => !!target?.closest?.(selector);
		const key = e.key.toLowerCase();
		// 復原、重做：輸入框裡、對話框開著時也是退回流程，不讓瀏覽器自己復原（畫面和資料才不會對不上）
		if ((e.ctrlKey || e.metaKey) && (key === 'z' || (key === 'y' && e.ctrlKey))) {
			e.preventDefault();
			undoKey(!(key === 'z' && !e.shiftKey));
			return;
		}
		// 空白鍵：焦點在按鈕、勾選框、選單、輸入框上時照一般網頁按下它；其他時候播放／暫停
		if (e.key === ' ') {
			if (on(NATIVE_KEYS) || e.repeat) return;
			// 對話框開著時只能暫停（播放自己管，頁面告訴它對話框有沒有開）
			if (playback.space(covered())) e.preventDefault();
			return;
		}
		// 對話框、八拍表蓋在上面時，其他快捷鍵不動到底下的編輯畫面
		if (covered() || on(TYPING)) return;
		// 選單自己用方向鍵、Home／End（例：任務角色選單）時不算
		const ownKeys = '[role="combobox"], [role="listbox"], [role="radiogroup"]';
		if ((e.key === 'Home' || e.key === 'End') && !e.defaultPrevented && !on(ownKeys)) {
			e.preventDefault();
			if (e.key === 'Home') playback.toStart();
			else playback.toEnd();
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && session.selectedFormationId) {
			e.preventDefault();
			session.removeFormation(session.selectedFormationId);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && session.selectedActionId) {
			// Mac 的 delete 鍵送的是 Backspace
			e.preventDefault();
			session.removeAction(session.selectedActionId);
		} else if (
			(e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
			!e.defaultPrevented &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey
		) {
			// 方向鍵移播放頭：一拍（Shift 一個八拍）。分界、選單、分頁自己用方向鍵時（已經 preventDefault）不算。
			if (on(ownKeys)) return;
			e.preventDefault();
			playback.step(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
		} else if (e.key === 'Escape') {
			session.clearSelection();
		} else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// 分組：選好人按 1–9 放進那組、0 拿出組。任務角色選單也用數字鍵，焦點在那裡不算。
			if (on('[role="combobox"]')) return;
			if (session.squadKey(Number(e.key))) e.preventDefault();
		}
	}

	/** 右邊欄的分頁：←→ 換到另一頁，焦點跟著過去（只有兩頁，往哪邊都是另一頁）。 */
	function tabKey(e: KeyboardEvent) {
		if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.ctrlKey || e.metaKey || e.altKey) return;
		e.preventDefault();
		editor.inspectorTab = editor.inspectorTab === 'action' ? 'members' : 'action';
		flushSync();
		document.getElementById(`tab-${editor.inspectorTab}`)?.focus();
	}

	/** 兩條分界都回到預設（雙擊分界也可以，一次一條）。 */
	function resetLayout() {
		timelineDivider.set(null);
		inspectorDivider.set(null);
	}
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>
<svelte:window
	{onkeydown}
	{onbeforeunload}
	onpointerdowncapture={dismissNotice}
	onkeydowncapture={dismissNotice}
	bind:innerWidth={windowW}
/>

{#if flow}
	{@const warnings = timeRuleWarnings(flow)}
	<div
		class="editor"
		inert={overlayOpen}
		class:practicing={view === 'practice'}
		class:print-hidden={printOpen}
		style:--timeline-h={timelineDivider.px === null ? undefined : `clamp(${TIMELINE_MIN_PX}px, ${timelineDivider.px}px, calc(100dvh - ${FIELD_KEEP_PX}px))`}
		style:--inspector-w="{inspectorPx}px"
	>
		<!-- 提示（存檔、開檔的結果…）：編排時浮在場地上，練習時浮在練習畫面上 -->
		{#snippet noticeToast()}
			{#if session.notice}
				<div
					class="toast"
					role="presentation"
					onpointerenter={() => session.holdNotice(true)}
					onpointerleave={() => session.holdNotice(false)}
				>
					<span role="status">{session.notice}</span>
					{#if session.noticeUndo}
						<button type="button" class="ghost undo" aria-label={session.noticeUndo} onclick={undo}>復原</button>
					{/if}
					<button type="button" class="ghost icon" aria-label="收起提示" onclick={() => (session.notice = '')}
						><Icon name="close" size={14} /></button
					>
				</div>
			{/if}
		{/snippet}
		<header class="topbar">
			<div class="title">
				<b title={flow.name}>{flow.name}</b>
				<!-- 「未存」的位置一直留著：出現時不把「編排｜練習」推走 -->
				<span class="unsaved-slot"
					>{#if unsaved}<span class="unsaved" title="有還沒存的修改（⌘S／Ctrl+S 存檔）">未存</span>{/if}</span
				>
				<div class="view" role="group" aria-label="編排｜練習">
					<button type="button" aria-pressed={view === 'edit'} onclick={() => setView('edit')}>編排</button>
					<button type="button" aria-pressed={view === 'practice'} onclick={() => setView('practice')}>練習</button>
				</div>
				<!-- 放在名字這一欄：右邊的按鈕已經滿了，再加會壓到中間的播放區 -->
				<a class="btn ghost guide-link" href={guideHref} target="_blank" rel="noopener" title="使用說明"
					><Icon name="help" /><span class="guide-text">使用說明</span></a
				>
			</div>

			<div class="transport" hidden={view === 'practice'}>
				<button
					type="button"
					class="play"
					class:on={playback.playing}
					aria-label={playback.playing ? '暫停' : '播放'}
					title={flow.segments.length ? '空白鍵也可以播放／暫停' : '先加一段'}
					disabled={!flow.segments.length && !playback.playing}
					onclick={() => playback.toggle()}><Icon name={playback.playing ? 'pause' : 'play'} size={18} /></button
				>
				<div class="board">
					<span class="pos" aria-label="目前位置"
						>{#if position}<span class="pos-seg">{position.segment}</span>
							<span class="pos-at">{position.at}</span>{:else}<span class="pos-seg">還沒有段</span>{/if}</span
					>
					<span class="clock">{clock(playback.sec)} <i>/ {clock(totalSeconds(flow))}</i></span>
				</div>
				<label class="toggle" title="播放時每拍響一聲">
					<input
						type="checkbox"
						checked={playback.metronome}
						onchange={(e) => playback.setMetronome(e.currentTarget.checked)}
					/>
					<Icon name="metronome" />節拍器
				</label>
				<label class="latency" title="用藍牙耳機時，畫面比聲音快就調大。存在這台電腦，不進流程檔。">
					<span class="latency-text">延遲校正（毫秒）</span>
					<input
						type="number"
						step="10"
						min={-MAX_LATENCY_MS}
						max={MAX_LATENCY_MS}
						value={playback.latencyMs}
						onchange={(e) => {
							// 清空、不合法或超出範圍：沒改，欄位回到現在的值（不然欄位空著，實際還在用舊值）
							if (!playback.setLatency(e.currentTarget.valueAsNumber)) e.currentTarget.value = String(playback.latencyMs);
						}}
					/>
				</label>
			</div>

			<div class="actions">
				<!-- 練習時沒有復原、重做：復原只退編排的修改，在練習畫面看不到退了什麼，還可能弄掉紀錄 -->
				{#if view === 'edit'}
					<!-- 關掉是檢視模式：只能看、只能播放。改流程的指令由 session 擋下，不只是藏按鈕 -->
					<label class="toggle" title="關掉是檢視模式：只能看、只能播放，不會不小心改到">
						<input
							type="checkbox"
							role="switch"
							checked={!session.viewing}
							onchange={(e) => (session.viewing = !e.currentTarget.checked)}
						/>編輯
					</label>
					{#if !session.viewing}
						<button type="button" class="ghost" title="復原（⌘Z／Ctrl+Z）" disabled={!session.canUndo} onclick={undo}
							><Icon name="undo" /><span class="narrow-hide">復原</span></button
						>
						<button
							type="button"
							class="ghost"
							title="重做（⌘⇧Z／Ctrl+Shift+Z、Ctrl+Y）"
							disabled={!session.canRedo}
							onclick={redo}><Icon name="redo" /><span class="narrow-hide">重做</span></button
						>
					{/if}
					<span class="sep" aria-hidden="true"></span>
				{/if}
				<!-- 八拍表的字一直留著：使用說明都叫它「八拍表」，只有印表機圖示認不出來 -->
				<button type="button" class="ghost" title="八拍表" onclick={() => (printOpen = true)}
					><Icon name="print" />八拍表</button
				>
				{#if view === 'edit' && !session.viewing}
					<button type="button" class="ghost" title="流程設定" onclick={() => (settingsOpen = true)}
						><Icon name="settings" /><span class="narrow-hide">流程</span>設定</button
					>
				{/if}
				<span class="sep" aria-hidden="true"></span>
				<label class="open btn ghost"><Icon name="open" />開啟<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
				<button type="button" class="ghost" onclick={() => editor.file.startNew()}><Icon name="new" />新建</button>
				<button type="button" class="primary save" title="⌘S／Ctrl+S" onclick={() => editor.file.save()}><Icon name="save" />存檔</button>
			</div>
		</header>

		<main class="field-host" hidden={view === 'practice'} {@attach watchFieldHostH}>
			<Field
				field={flow.field}
				members={flow.members}
				markers={memberMarkers(flow)}
				positions={positionsAt(flow, playback.sec)}
				raised={raisedAt(flow, playback.sec)}
				{toMeters}
				ghosts={trail.ghosts}
				walks={trail.walks}
				clashes={trail.clashes}
				badges={squadBadges}
			>
				{#snippet below()}
					{#if groupingAction && flow}
						<SquadBar action={groupingAction} />
					{/if}
				{/snippet}
				{#snippet railTop()}
					{#if touchScreen || timelineDivider.px !== null || inspectorDivider.px !== null}
						<div class="select-tools">
							{#if touchScreen}
								<label class="toggle-btn" title="打開後，場上點人、框選、點泳道名字都是加選或拿掉（跟按著 Shift 一樣）">
									<input type="checkbox" bind:checked={session.multiSelect} />多選
								</label>
								<button type="button" disabled={!session.anySelected} onclick={() => session.clearSelection()}>取消選取</button>
							{/if}
							{#if timelineDivider.px !== null || inspectorDivider.px !== null}
								<button type="button" class="ghost" onclick={resetLayout}>版面回原狀</button>
							{/if}
						</div>
					{/if}
					{#if flow}
						{@const now = currentFormation(flow, playback.sec)}
						<div class="now-formation" aria-label="現在的站位">
							<span class="now-label">現在站位</span>
							<div class="now-row">
								<span class="now-no">{now.number}</span>
								{#if now.formation.name}
									<strong class="now-name" title={now.formation.name}>{now.formation.name}</strong>
								{:else}
									<span class="now-name unnamed">站位 {now.number}</span>
								{/if}
							</div>
						</div>
					{/if}
					{#if warnings.length}
						<div class="warn" title="規則警告（只提醒，不擋）；在「流程設定」調整">
							<Icon name="warn" />
							<span class="warn-text">{#each warnings as w (w)}<span>{w}</span>{/each}</span>
						</div>
					{/if}
					{#if flow}
						{@const stacked = stackedMembers(flow.members, positionsAt(flow, playback.sec))}
						{#if stacked.length}
							<p class="hint-warn" role="note">
								{stacked.map((g) => g.map((m) => m.name).join('、')).join('；')} 疊在同一點：被蓋住的人看不到也點不到，拖開一點比較好
							</p>
						{/if}
						<CueOverlay {flow} />
					{/if}
				{/snippet}
				{#snippet railBottom()}
					{#if flow?.members.length}
						<FormationEditor />
					{/if}
				{/snippet}
			{#if flow.members.length === 0}
				<div class="field-empty">
					<b>場上還沒有人</b>
					<span>到右邊的「隊員」加人，他們會排進場地中間的空格點（場地站滿了才排到場外），可以直接拖。</span>
				</div>
			{/if}
			<!-- 場上的確認框和提示疊在場地上方：不蓋到「正面／裁判」和站在正面場外的人 -->
			<div class="field-toasts">
				{#if session.ask.question}
					<div class="toast-confirm">
						<ConfirmList ask={session.ask} />
					</div>
				{/if}
				{@render noticeToast()}
			</div>
			</Field>
		</main>

		<aside class="inspector" hidden={view === 'practice'}>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (可以聚焦、用 ←→ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
			<div
				class="col-split"
				role="separator"
				aria-orientation="vertical"
				aria-label="場地和右邊欄的分界"
				aria-valuenow={inspectorPx}
				aria-valuemin={INSPECTOR_MIN_PX}
				tabindex="0"
				title="拖這裡調整右邊欄的寬度（雙擊或按場地左邊的「版面回原狀」回到自動）"
				{@attach inspectorDivider.attach}
			></div>
			<!-- svelte-ignore a11y_interactive_supports_focus (焦點在裡面的分頁上，←→ 從分頁冒上來；分頁列本身不用停) -->
			<div class="tabs" role="tablist" aria-label="右邊欄" onkeydown={tabKey}>
				<button
					type="button"
					role="tab"
					id="tab-action"
					aria-selected={editor.inspectorTab === 'action'}
					aria-controls="panel-action"
					onclick={() => (editor.inspectorTab = 'action')}><Icon name="bolt" />動作</button
				>
				<button
					type="button"
					role="tab"
					id="tab-members"
					aria-selected={editor.inspectorTab === 'members'}
					aria-controls="panel-members"
					onclick={() => (editor.inspectorTab = 'members')}
					><Icon name="people" />隊員<span class="count">{flow.members.length}</span></button
				>
			</div>
			<div class="panel" id="panel-action" role="tabpanel" aria-labelledby="tab-action" hidden={editor.inspectorTab !== 'action'}>
				<MemberPicker />
				<WalkForm />
				<ActionForm {cellAt} />
			</div>
			<div class="panel" id="panel-members" role="tabpanel" aria-labelledby="tab-members" hidden={editor.inspectorTab !== 'members'}>
				<MemberPanel />
			</div>
		</aside>

		<!-- svelte-ignore a11y_no_noninteractive_tabindex (可以聚焦、用 ↑↓ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
		<div
			class="split"
			hidden={view === 'practice'}
			role="separator"
			aria-orientation="horizontal"
			aria-label="場地和時間軸的分界"
			aria-valuenow={timelineDivider.px ?? currentTimelineH()}
			aria-valuemin={TIMELINE_MIN_PX}
			tabindex="0"
			title="拖這裡調整場地和時間軸的高度（雙擊或按場地左邊的「版面回原狀」回到預設）"
			{@attach timelineDivider.attach}
		></div>

		<div class="timeline-host" hidden={view === 'practice'} bind:this={timelineHost}>
			<Timeline onopensegment={(id) => (openSegmentId = id)} clashes={allClashes} />
		</div>
		{#if view === 'practice'}
			<div class="practice-host">
				<!-- 換一份流程就重開，點了還沒存的記號不會帶到別的檔 -->
				{#key opened}
					<Practice date={practiceDate} ondate={(d) => (practiceDate = d)} />
				{/key}
				{@render noticeToast()}
			</div>
		{/if}
	</div>
	<!-- 窄螢幕、iPad 拿直的：編輯畫面擋住，但留「回首頁」「看八拍表」「去練習」，不會被困住（練習、記錄、總表、八拍表照常能用，docs/adr/0005-ipad-touch.md） -->
	{#snippet coverWays()}
		<div class="cover-ways">
			<button type="button" onclick={() => editor.file.leaveToHome()}>回首頁</button>
			<button type="button" onclick={() => (printOpen = true)}>看八拍表</button>
			<button type="button" class="primary" onclick={() => setView('practice')}>去練習</button>
		</div>
	{/snippet}
	<!-- 八拍表開著時收起來：從提示上的「看八拍表」打開的，關掉再回來 -->
	{#if view === 'edit' && !printOpen}
		<!-- iPad 拿直的：場地會被擠到看不見，請教練轉成橫的（只在觸控螢幕顯示） -->
		<section class="cover-hint rotate-hint" aria-labelledby="rotate-hint-title">
			<Icon name="fit" size={28} />
			<b id="rotate-hint-title">請把 iPad 轉成橫的</b>
			<span>編輯畫面要橫著放，場地和時間軸才放得下。練習、記錄、看八拍表直著也可以。</span>
			{@render coverWays()}
		</section>
		<!-- 視窗太窄（手機、直拿 iPad、縮小的視窗）：場地太小點不到、上方列的按鈕疊在一起。排在後面，手機拿直的時蓋過上面那張 -->
		<section class="cover-hint narrow-hint" aria-labelledby="narrow-hint-title">
			<Icon name="fit" size={28} />
			<b id="narrow-hint-title">視窗太窄了</b>
			<span>編輯畫面要至少 1024 像素寬、600 像素高，場地才夠大。請用電腦，或把平板轉成橫的。練習、記錄、看八拍表在這裡就可以。</span>
			{@render coverWays()}
		</section>
	{/if}
	{#if openSegmentId}
		<SegmentSettings
			segmentId={openSegmentId}
			{waveXToSec}
			onclose={() => {
				playback.stopPreview();
				openSegmentId = null;
			}}
		/>
	{/if}
	{#if settingsOpen}
		<FlowSettings onclose={() => (settingsOpen = false)} />
	{/if}
	{#if printOpen}
		<PrintSheet {flow} onclose={() => (printOpen = false)} />
	{/if}
	{#if editor.file.asking}
		<div class="backdrop discard">
			<div class="discard-box">
				<ConfirmList
					message={`「${flow.name}」還沒存，改的東西會不見。`}
					items={[]}
					confirmLabel="不存了，繼續"
					onconfirm={() => editor.file.answer('discard')}
					extra={{ label: '先存檔', onclick: () => editor.file.answer('save') }}
					oncancel={() => editor.file.answer('cancel')}
				/>
			</div>
		</div>
	{/if}
{:else}
	<div class="home">
		<a class="btn home-guide" href={guideHref} target="_blank" rel="noopener"><Icon name="help" />使用說明</a>
		<section class="intro">
			<svg class="intro-mat" viewBox="0 0 90 70" aria-hidden="true">
				{#each Array.from({ length: 9 }, (_, i) => i) as i (i)}
					<rect x={i * 10} y="0" width="9.4" height="70" rx="0.6" />
				{/each}
				<circle class="b" cx="25" cy="44" r="3.2" />
				<circle class="t" cx="35" cy="30" r="3.2" />
				<circle class="b" cx="45" cy="44" r="3.2" />
				<circle class="t" cx="55" cy="30" r="3.2" />
				<circle class="b" cx="65" cy="44" r="3.2" />
			</svg>
			<h1>競技啦啦隊<br />流程編輯器</h1>
			<p>
				音樂、八拍、站位和每個人的角色，排在同一條時間軸上。存成一個流程檔，傳給隊員用同一個編輯器打開。
			</p>
		</section>

		<section class="start">
			<NewFlowForm oncreate={(f) => editor.file.create(f)} />
			<div class="home-open">
				<span>已經有流程檔？</span>
				<label class="open btn"><Icon name="open" />開啟流程檔<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
			</div>
			{#if editor.file.openError}<p class="error" role="alert">{editor.file.openError}</p>{/if}
			{#if editor.file.recent.length}
				<div class="recent">
					<h2 id="recent-title">最近的流程</h2>
					<ul aria-labelledby="recent-title">
						{#each editor.file.recent as f (f.id)}
							<li>
								<button type="button" class="recent-open" disabled={f.busy} onclick={() => editor.file.openRecent(f.id)}>
									<span class="recent-name">{f.name}</span>
									<span class="recent-meta"
										>{[f.savedAt ? draftTime(f.savedAt) : '', f.busy ? '另一個分頁正在編' : f.unsaved ? '還沒存' : '']
											.filter(Boolean)
											.join('・')}</span
									>
								</button>
								<button type="button" class="link recent-drop" aria-label={`丟掉「${f.name}」`} onclick={() => (discarding = f)}>丟掉</button>
							</li>
						{/each}
					</ul>
					<p class="recent-note">草稿只存在這台電腦的瀏覽器。只是打開看、不小心改到的，按「丟掉」再開原檔。</p>
				</div>
			{/if}
		</section>
		{#if discarding}
			{@const f = discarding}
			<div class="backdrop discard">
				<div class="discard-box">
					<ConfirmList
						message={f.unsaved
							? `丟掉「${f.name}」的草稿？還沒存的修改會不見，不能復原。`
							: `丟掉「${f.name}」的草稿？流程檔不會動，只是不列在最近的流程。`}
						items={[]}
						confirmLabel="丟掉"
						onconfirm={() => {
							const id = f.id;
							discarding = null;
							void editor.file.discardRecent(id);
						}}
						oncancel={() => (discarding = null)}
					/>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ---------- 編輯畫面的大格子 ---------- */
	.editor {
		/* dvh：iPad Safari 的網址列不會擋到下面的時間軸。 */
		height: 100dvh;
		display: grid;
		/* 上方列｜場地＋右邊欄｜分界｜時間軸。時間軸預設 30vh，拖分界改的高度放在 --timeline-h。 */
		grid-template-rows: auto minmax(0, 1fr) auto var(--timeline-h, minmax(200px, 30vh));
		/* 場地｜右邊欄。右邊欄的寬度放在 --inspector-w（沒拖過時照螢幕大小自動分）。 */
		grid-template-columns: minmax(0, 1fr) var(--inspector-w, 360px);
		background: var(--paper);
	}
	/* 練習：主畫面換成練習畫面，編排的東西藏起來（不拆掉：場地、時間軸的縮放還在） */
	.editor.practicing {
		grid-template-rows: auto minmax(0, 1fr);
	}
	.editor > [hidden],
	.topbar > [hidden] {
		display: none;
	}
	.practice-host {
		position: relative;
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		/* 表格很寬時（人多）只有表格自己左右捲，不把練習畫面撐開 */
		grid-template-columns: minmax(0, 1fr);
	}
	.split {
		grid-column: 1 / -1;
		position: relative;
		height: 7px;
		cursor: row-resize;
		touch-action: none;
		background: var(--line-soft);
		border-top: 1px solid var(--line);
	}
	/* 中間一小條把手，看得出可以拖。 */
	.split::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 2px;
		width: 36px;
		height: 3px;
		margin-left: -18px;
		border-radius: 2px;
		background: var(--muted);
		opacity: 0.45;
	}
	.split:hover,
	.split:focus-visible {
		background: var(--sel-soft);
		outline: none;
	}
	.split:hover::after,
	.split:focus-visible::after {
		background: var(--sel);
		opacity: 1;
	}
	/* 手指：兩條分界點得到的範圍變大（蓋到旁邊一點），看起來不變。 */
	@media (pointer: coarse) {
		.split {
			z-index: 9;
		}
		.split::before {
			content: '';
			position: absolute;
			inset: -9px 0;
		}
		.col-split {
			left: -12px;
			width: 24px;
		}
		.col-split::after {
			left: 10px;
		}
	}

	/* ---------- 上方列：深藍底，像記分板 ---------- */
	.topbar {
		grid-column: 1 / -1;
		display: grid;
		/* 播放區放中間；右邊的按鈕不夠放時，播放區往左讓，按鈕不疊上去 */
		grid-template-columns: minmax(min-content, 1fr) auto minmax(max-content, 1fr);
		align-items: center;
		gap: 16px;
		padding: 8px 12px 8px 16px;
		background: var(--ink);
		color: #e8ecf5;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	.title b {
		font-size: 16px;
		font-weight: 700;
		color: #fff;
		/* 只畫一行，放不下用「…」。不用 nowrap：名字這一欄最窄是 min-content（「編排｜練習」才不會被播放區壓到），
		   nowrap 的長名字會把它撐開、右邊的按鈕擠出畫面；能在任何字斷開，名字就不算進最窄的寬度。 */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		overflow-wrap: anywhere;
		overflow: hidden;
	}
	.unsaved-slot {
		flex: none;
		min-width: 3em;
		font-size: 12px;
	}
	.unsaved {
		font-size: 12px;
		color: #ffd27a;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.unsaved::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	/* 編排｜練習 */
	.view {
		flex: none;
		align-self: center;
		display: inline-flex;
		padding: 3px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.12);
	}
	.view button {
		border: 0;
		border-radius: 6px;
		padding: 3px 12px;
		background: none;
		color: #cbd5e1;
	}
	.view button:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.view button[aria-pressed='true'] {
		background: #fff;
		color: var(--ink);
		font-weight: 700;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.play {
		width: 40px;
		height: 40px;
		padding: 0;
		border-radius: 50%;
		background: var(--now);
		border-color: var(--now);
		color: #fff;
	}
	.play:hover {
		background: #ff6a45;
		border-color: #ff6a45;
	}
	/* 沒有段：灰的，按不下去 */
	.play:disabled,
	.play:disabled:hover {
		background: var(--muted, #66718a);
		border-color: var(--muted, #66718a);
	}
	.play.on {
		background: #fff;
		border-color: #fff;
		color: var(--ink);
	}
	.board {
		display: grid;
		grid-template-columns: auto;
		min-width: 168px;
		padding: 3px 12px 4px;
		border-radius: var(--radius);
		background: #0c1426;
		box-shadow: inset 0 0 0 1px #2b3754;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}
	.pos {
		display: flex;
		align-items: baseline;
		gap: 8px;
		white-space: nowrap;
	}
	.pos-seg {
		font-size: 12px;
		color: #9fb0d4;
	}
	.pos-at {
		font-size: 20px;
		font-weight: 700;
		color: #fff;
		letter-spacing: 0.02em;
	}
	.clock {
		font-size: 11px;
		color: #8b99b8;
	}
	.clock i {
		font-style: normal;
		color: #5d6a88;
	}
	.toggle,
	.latency {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #c9d2e6;
		white-space: nowrap;
		cursor: pointer;
	}
	.toggle {
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid #36425f;
	}
	/* 手指：節拍器至少 32px 高 */
	@media (pointer: coarse) {
		.toggle {
			min-height: 32px;
		}
	}
	.toggle:has(input:checked) {
		background: #24304c;
		border-color: #4a5a80;
		color: #fff;
	}
	.toggle input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.toggle:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.latency input {
		width: 64px;
		background: #0c1426;
		color: #fff;
		border-color: #36425f;
		padding: 3px 6px;
	}

	.actions {
		/* 一定在最右邊那一欄（練習時播放區藏起來，也不會跑到中間） */
		grid-column: -2 / -1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		min-width: 0;
	}
	.actions :global(button.ghost),
	.actions .btn.ghost {
		color: #d6ddec;
	}
	.actions :global(button.ghost:hover),
	.actions .btn.ghost:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.actions .save {
		margin-left: 4px;
	}
	.guide-link {
		flex: none;
		color: #d6ddec;
		text-decoration: none;
	}
	.guide-link:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.sep {
		width: 1px;
		height: 20px;
		background: #36425f;
		margin: 0 4px;
	}
	/* 左欄：多選、取消選取、版面回原狀（iPad 沒有 Shift、Esc，也不好雙擊分界）。 */
	.select-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.toggle-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		padding: 4px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-size: 13px;
		line-height: 20px;
		cursor: pointer;
		user-select: none;
	}
	.toggle-btn:has(input:checked) {
		background: var(--sel);
		border-color: var(--sel);
		color: #fff;
		font-weight: 600;
	}
	.toggle-btn:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.toggle-btn input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	/* 左欄（場地左邊）的東西：警告、跟上一張一樣、拖人會改。 */
	.warn {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 10px;
		background: var(--warn-bg);
		border: 1px solid #f0d488;
		color: var(--warn-text);
		font-size: 12px;
		font-weight: 500;
	}
	/* 左欄最上面：播放頭這一刻用的站位。號碼跟站位縮圖列一樣是深色小方塊，左邊一條墊子藍。 */
	.now-formation {
		align-self: stretch;
		display: grid;
		gap: 4px;
		padding: 8px 12px 10px;
		border-radius: 10px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-left: 4px solid var(--mat, #2f66b8);
		box-shadow: 0 1px 2px rgba(22, 33, 58, 0.06);
	}
	.now-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.now-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.now-no {
		flex: none;
		min-width: 22px;
		padding: 0 5px;
		border-radius: 5px;
		background: var(--ink, #16213a);
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		line-height: 22px;
		text-align: center;
	}
	.now-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 18px;
		font-weight: 700;
		color: var(--ink, #16213a);
	}
	.now-name.unnamed {
		font-weight: 600;
		color: var(--muted);
	}
	.warn :global(svg) {
		flex: none;
		margin-top: 1px;
	}
	.warn span + span::before {
		content: '／';
		margin-right: 6px;
	}

	/* 選檔用的 input 藏起來，外面的 label 看起來像按鈕。 */
	.open {
		position: relative;
	}
	.open:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.open input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	/* ---------- 場地 ---------- */
	.field-host {
		position: relative;
		min-height: 0;
		padding: 12px;
	}
	.field-empty {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: grid;
		gap: 4px;
		max-width: 300px;
		padding: 14px 18px;
		text-align: center;
		background: rgba(255, 255, 255, 0.94);
		border-radius: 10px;
		box-shadow: var(--shadow-pop);
		font-size: 13px;
		color: var(--muted);
		pointer-events: none;
	}
	.field-empty b {
		color: var(--text);
		font-size: 14px;
	}
	/* 練習畫面：放在下方。場地上的放在上方（見 .field-toasts）。 */
	.toast {
		position: absolute;
		bottom: 14px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: min(560px, calc(100% - 32px));
		padding: 6px 6px 6px 14px;
		border-radius: 10px;
		background: var(--ink);
		color: #fff;
		font-size: 13px;
		box-shadow: var(--shadow-pop);
		animation: drop 0.18s ease-out;
	}
	/* 場地上的確認框和提示：從上方往下排，不蓋到下面的「正面／裁判」和正面場外的人。 */
	.field-toasts {
		position: absolute;
		top: 14px;
		left: 16px;
		right: 16px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.field-toasts > :global(*) {
		pointer-events: auto;
	}
	.field-toasts .toast {
		position: static;
		transform: none;
		max-width: min(560px, 100%);
		animation-name: drop-in;
	}
	@keyframes drop-in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	.toast-confirm {
		width: min(420px, 100%);
		box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18);
		border-radius: 10px;
	}
	.toast button {
		color: #b8c3da;
		width: 24px;
		height: 24px;
	}
	.toast .undo {
		width: auto;
		padding: 0 8px;
		color: #fff;
		font-weight: 700;
		text-decoration: underline;
	}
	.toast button:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translate(-50%, 6px);
		}
	}

	/* ---------- 右邊欄 ---------- */
	.inspector {
		position: relative;
		min-height: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		background: var(--surface);
		border-left: 1px solid var(--line);
	}
	/* 右邊欄左邊緣上一條看不太出來的細條，滑過去才亮，拖它改寬度。 */
	.col-split {
		position: absolute;
		left: -4px;
		top: 0;
		bottom: 0;
		z-index: 5;
		width: 8px;
		cursor: col-resize;
		touch-action: none;
	}
	.col-split::after {
		content: '';
		position: absolute;
		left: 2px;
		top: 50%;
		width: 3px;
		height: 36px;
		margin-top: -18px;
		border-radius: 2px;
		background: var(--muted);
		opacity: 0.45;
	}
	.col-split:hover,
	.col-split:focus-visible {
		background: var(--sel-soft);
		outline: none;
	}
	.col-split:hover::after,
	.col-split:focus-visible::after {
		background: var(--sel);
		opacity: 1;
	}
	.tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		padding: 8px 10px 0;
		border-bottom: 1px solid var(--line);
	}
	.tabs button {
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 6px 6px 0 0;
		padding: 8px 10px 9px;
		font-size: 14px;
		font-weight: 600;
		color: var(--muted);
		background: none;
	}
	.tabs button:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.tabs button[aria-selected='true'] {
		color: var(--mat);
		border-bottom-color: var(--mat);
	}
	.count {
		min-width: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--line-soft);
		color: var(--muted);
		font-size: 11px;
		line-height: 18px;
	}
	.tabs button[aria-selected='true'] .count {
		background: var(--mat-soft);
		color: var(--mat);
	}
	.panel {
		/* 右邊欄變寬時，裡面的表單看自己有多寬排版（@container） */
		container-type: inline-size;
		min-height: 0;
		overflow-y: auto;
		padding: 14px 16px 24px;
		display: grid;
		align-content: start;
		gap: 18px;
	}
	.panel[hidden] {
		display: none;
	}

	/* 讓時間軸撐滿這一列、自己捲動。 */
	.timeline-host {
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
	}

	.discard {
		align-items: flex-start;
		padding-top: 72px;
	}
	.discard-box {
		width: min(420px, 100%);
		box-shadow: var(--shadow-pop);
		border-radius: 10px;
	}

	@media print {
		.print-hidden {
			display: none;
		}
		/* 印記一次全上表、總表：只印練習畫面裡的表，不印上方列和提示 */
		.editor.practicing {
			display: block;
			height: auto;
			background: none;
		}
		.editor.practicing > .topbar,
		.toast {
			display: none;
		}
	}

	/* 蓋住編輯畫面的提示：iPad 拿直的請教練轉成橫的、視窗太窄。 */
	.cover-hint {
		display: none;
		position: fixed;
		inset: 0;
		z-index: 100;
		place-content: center;
		justify-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		background: var(--ink);
		color: #c9d2e6;
		font-size: 15px;
	}
	.cover-hint b {
		color: #fff;
		font-size: 22px;
	}
	.cover-hint > span {
		max-width: 28em;
	}
	.cover-ways {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-top: 6px;
	}
	/* screen：列印八拍表時（紙是直的）不能印到它。 */
	@media screen and (pointer: coarse) and (orientation: portrait) {
		.rotate-hint {
			display: grid;
		}
	}
	@media screen and (max-width: 1023px), screen and (max-height: 599px) {
		.narrow-hint {
			display: grid;
		}
	}

	/* 窄一點的視窗：延遲校正只留輸入框（名字還在，滑過去看得到說明），不整個藏起來。
	   上方列多了「編排｜練習」，所以從 1540px 就開始收（再寬一點才收，流程名字會被擠到剩兩三個字）。 */
	@media (max-width: 1540px) {
		.latency-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.latency::before {
			/* 只給眼睛看的短名字；讀屏還是讀完整的「延遲校正（毫秒）」 */
			content: '延遲' / '';
		}
		.latency input {
			width: 56px;
		}
		/* 復原、重做只留圖示，流程設定只留「設定」，右邊的按鈕才擠得下；讀屏照樣讀得到名字 */
		.narrow-hide {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* 再窄就一行放不下：播放區換到第二行，名字和按鈕留在第一行（一行硬塞的話，流程名字只剩四五個字）。
	   右邊多了「編輯」開關，所以從 1410px 就換。 */
	@media (max-width: 1410px) {
		.topbar {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.transport {
			grid-row: 2;
			grid-column: 1 / -1;
			justify-content: center;
		}
	}
	@media (max-width: 1280px) {
		/* 使用說明最後才縮成圖示（新手照說明找「使用說明」這幾個字）；讀屏照樣讀得到名字 */
		.guide-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* 手機：名字一行、按鈕一行（不收進選單）。一行硬塞的話名字被擠到 0，名字這一欄的按鈕還會畫到右邊按鈕上，點錯。 */
	@media (max-width: 760px) {
		.topbar {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 6px;
			padding: 6px 12px;
		}
		.title b {
			flex: 1 1 0;
			min-width: 2em;
		}
		.actions {
			grid-row: 2;
			flex-wrap: wrap;
		}
		.transport {
			grid-row: 3;
		}
	}

	/* ---------- 首頁 ---------- */
	.home {
		position: relative;
		min-height: 100dvh;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
		gap: 56px;
		align-items: center;
		max-width: 1040px;
		margin: 0 auto;
		padding: 48px 32px;
	}
	.home-guide {
		position: absolute;
		top: 16px;
		right: 16px;
		text-decoration: none;
	}
	.intro {
		display: grid;
		gap: 20px;
		align-content: center;
	}
	.intro-mat {
		width: 180px;
		height: auto;
	}
	.intro-mat rect {
		fill: var(--mat);
	}
	.intro-mat rect:nth-child(odd) {
		fill: #3570c4;
	}
	.intro-mat circle {
		stroke: var(--ink);
		stroke-width: 0.8;
	}
	.intro-mat .b {
		fill: #fff;
	}
	.intro-mat .t {
		fill: var(--top);
	}
	/* 「競技啦啦隊」「流程編輯器」各一行，不在字中間斷開：欄窄（761–900 寬）時字跟著縮 */
	.intro h1 {
		font-size: clamp(30px, 4.4vw, 40px);
		word-break: keep-all;
		line-height: 1.15;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--ink);
	}
	.intro p {
		max-width: 26em;
		font-size: 15px;
		line-height: 1.7;
		color: var(--muted);
	}
	.start {
		display: grid;
		/* 最近的流程名字很長時不撐寬整欄（名字自己截斷） */
		grid-template-columns: minmax(0, 1fr);
		gap: 14px;
	}
	.home-open {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--muted);
		font-size: 13px;
	}
	.home .error {
		text-align: center;
	}
	.recent {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
		margin-top: 10px;
	}
	.recent h2 {
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.recent ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
	}
	.recent li {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.recent-open {
		flex: 1;
		min-width: 0;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
	}
	.recent-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}
	.recent-meta {
		color: var(--muted);
		font-size: 12px;
	}
	.recent-drop {
		color: var(--muted);
		font-size: 12px;
	}
	.recent-note {
		color: var(--muted);
		font-size: 12px;
	}
	@media (max-width: 760px) {
		.home {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
			padding: 32px 16px;
		}
		.intro h1 {
			font-size: 30px;
		}
	}
</style>
