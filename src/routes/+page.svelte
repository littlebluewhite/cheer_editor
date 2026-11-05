<script lang="ts">
	import {
		currentFormation,
		deleteAction,
		firstBeatPreview,
		formationAt,
		formationTimes,
		clashes,
		formationWalks,
		memberMarkers,
		playbackPlan,
		playStartSec,
		NO_SQUAD_COLOR,
		positionText,
		positionsAt,
		raisedAt,
		readFlowFile,
		segmentsMissingAudio,
		squadColor,
		squadNumber,
		timeRuleWarnings,
		stackedMembers,
		stepPlayhead,
		totalSeconds,
		writeFlowFile,
		type ConfirmOption,
		type Flow,
		type Clash,
		type FormationWalk,
		type Position
	} from '#lib/core';
	import { decodeAudio, type DecodedAudio, type LoadedAudio } from '#lib/audio/decode.js';
	import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
	import { createPlayer, type Player } from '#lib/audio/player.js';
	import { createIndexedDbDraftStore, type Draft, type DraftStore } from '#lib/file/draft.js';
	import { browserFilePicker, createBrowserSaver, flowFileName, type FileSaver, type PickedFile } from '#lib/file/save.js';
	import { EditorSession, setEditorSession } from '#lib/editor-session.svelte.js';
	import { flushSync, onMount, untrack, type ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		loadInspectorWidth,
		MAX_LATENCY_MS,
		loadLatencyMs,
		loadTimelineHeight,
		saveInspectorWidth,
		saveLatencyMs,
		saveTimelineHeight
	} from '#lib/local-settings.js';
	import { autoInspectorWidth, clampInspectorWidth, INSPECTOR_MIN_PX } from '#lib/editor-layout.js';
	import { setUnsavedChanges } from '#lib/unsaved.js';
	import { flushPendingInput, settlePendingInput } from '#lib/pending-input.js';
	import { localDate } from '#lib/local-date.js';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import ConfirmList from '#lib/components/ConfirmList.svelte';
	import type CueGrid from '#lib/components/CueGrid.svelte';
	import CueOverlay from '#lib/components/CueOverlay.svelte';
	import Field, { fullView } from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import FormationEditor from '#lib/components/FormationEditor.svelte';
	import Icon from '#lib/components/Icon.svelte';
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
		/** 音訊引擎；測試換成假的（jsdom 沒有 Web Audio）。第一次播放時才建立。 */
		createEngine?: (getBuffer: (audioId: string) => AudioBuffer | undefined) => AudioEngine;
		/** 存檔薄層，一支流程一個（記得存到哪個檔）；測試換成假的。 */
		createSaver?: () => FileSaver;
		/** 選流程檔、拿到存回它的存檔薄層（Chrome、Edge）；null 是瀏覽器不能（照舊用選檔欄位）。測試換成假的。 */
		pickFlowFile?: (() => Promise<PickedFile | null>) | null;
		/** 解碼音樂檔；測試換成假的（jsdom 沒有 Web Audio）。 */
		decode?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
		/** 草稿存在哪裡（預設 IndexedDB）；測試換成假的（jsdom 沒有 IndexedDB）。 */
		draftStore?: DraftStore;
		/** 編輯 session（流程和復原）；測試放一個帶好流程的進來，再讀它的流程。沒給就自己建。 */
		session?: EditorSession;
		// 螢幕座標換算（ADR 0002）：預設用瀏覽器算；jsdom 不算版面，測試換成假的。往下傳給場地、拍點格子、段設定的波形。
		/** 場地：指標位置換成場地公尺。 */
		toMeters?: ComponentProps<typeof Field>['toMeters'];
		/** 拍點格子：指標位置對到的格子。 */
		cellAt?: ComponentProps<typeof CueGrid>['cellAt'];
		/** 段設定的波形：滑鼠位置換成音樂檔的秒數。 */
		waveXToSec?: ComponentProps<typeof SegmentSettings>['waveXToSec'];
	}

	let {
		createEngine = createWebAudioEngine,
		createSaver = createBrowserSaver,
		pickFlowFile = browserFilePicker(),
		decode = decodeAudio,
		draftStore = createIndexedDbDraftStore(),
		session = new EditorSession(),
		toMeters,
		cellAt,
		waveXToSec
	}: Props = $props();
	// session 一開始給了就不換：放進 context 的就是這一個。
	// svelte-ignore state_referenced_locally
	setEditorSession(session);

	/** 使用說明開在新分頁：編輯畫面留著，還沒存的修改不會因為看說明而不見。 */
	const guideHref = resolve('/guide');

	const flow = $derived(session.flow);
	const unsaved = $derived(session.unsaved);
	/** 欄位裡打了字還沒送出（名字、備註這類欄位在失去焦點時才送進流程）：關分頁前也要問。 */
	let typing = $state(false);
	$effect(() => setUnsavedChanges(unsaved || typing));
	/** 有還沒存的修改時關分頁、重新整理：讓瀏覽器先問（草稿要停手 1 秒才存，最後的修改可能還沒進草稿）。 */
	function onbeforeunload(e: BeforeUnloadEvent) {
		if (unsaved || typing) e.preventDefault();
	}
	function oninput(e: Event) {
		if (flow && (e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')) typing = true;
	}
	const sent = () => (typing = false);
	/** 這支流程在檔案裡（從檔案開的、存過檔）：沒有未存的修改就不用草稿。剛建好、救回草稿的不在檔案裡。 */
	// svelte-ignore state_referenced_locally
	let onDisk = $state(!!session.flow);
	/** 這個分頁的流程要不要放在草稿裡。 */
	const ownsDraft = $derived(!!flow && (unsaved || !onDisk));
	/** 存檔薄層，一支流程一個（記得存到哪個檔）：第一次存檔才建，換流程就丟掉。 */
	let saver: FileSaver | null = null;
	let saving = false;
	/** 首頁開檔失敗的原因（編輯中失敗就放在上方列的 notice）。 */
	let openError = $state('');
	/** 打開時找到的草稿，等教練選救回或丟掉。busy = 按了丟掉，但另一個分頁正在編輯它。 */
	let draftOffer = $state.raw<{ bytes: Uint8Array; name: string; savedAt: Date | null; busy?: boolean } | null>(null);

	/** 讀過草稿了：在這之前不自動存，免得蓋掉還沒問過的草稿。 */
	let draftChecked = $state(false);

	/**
	 * 分頁之間的訊息：草稿只有一份，首頁要丟掉草稿前先問有沒有別的分頁正在編輯它（那個分頁會回答）。
	 * 沒有 BroadcastChannel 的瀏覽器就當作沒有別的分頁。
	 */
	const DRAFT_CHANNEL = 'cheer-editor-draft';
	let channel: BroadcastChannel | null = null;

	onMount(() => {
		if (typeof BroadcastChannel === 'function') {
			channel = new BroadcastChannel(DRAFT_CHANNEL);
			channel.addEventListener('message', (e) => {
				if (e.data === 'editing?' && ownsDraft) channel?.postMessage('editing');
			});
		}
		void checkDraft();
		return () => channel?.close();
	});

	async function checkDraft() {
		let draft: Draft | null = null;
		try {
			draft = await draftStore.load();
		} catch {
			// 讀不到草稿就當作沒有
		}
		const r = draft && readFlowFile(draft.bytes);
		// 等讀草稿的時候教練已經開始編了：不打斷他
		if (draft && r && r.kind === 'ok' && !flow) draftOffer = { ...draft, name: r.flow.name };
		draftChecked = true;
	}

	/** 另一個分頁回答它正在編輯草稿嗎（等一下下，沒人回就是沒有）。 */
	function otherTabEditing(): Promise<boolean> {
		const ch = channel;
		if (!ch) return Promise.resolve(false);
		return new Promise((resolve) => {
			const reply = (e: MessageEvent) => e.data === 'editing' && done(true);
			const timer = setTimeout(() => done(false), 300);
			function done(editing: boolean) {
				clearTimeout(timer);
				ch!.removeEventListener('message', reply);
				resolve(editing);
			}
			ch.addEventListener('message', reply);
			ch.postMessage('editing?');
		});
	}

	/**
	 * 編輯時自動存草稿：停手 1 秒才存（整個 zip 含音樂，不要每一下都存）。剛建好、還沒改的流程也存，重新整理救得回來。
	 * 存成流程檔或剛開流程檔（在檔案裡、沒有未存的修改）就丟掉草稿：檔案裡已經有了，下次打開不用問。
	 */
	const DRAFT_DELAY_MS = 1000;
	$effect(() => {
		if (!draftChecked || !flow) return;
		const f = flow;
		const keep = ownsDraft;
		const timer = setTimeout(() => {
			const done = keep ? draftStore.save(writeFlowFile(f, audioBytes(f))) : draftStore.clear();
			done.catch(() => {});
		}, DRAFT_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function restoreDraft(bytes: Uint8Array) {
		draftOffer = null;
		await openBytes(bytes, null);
	}

	async function discardDraft() {
		const offer = draftOffer;
		if (!offer) return;
		if (await otherTabEditing()) {
			if (draftOffer === offer) draftOffer = { ...offer, busy: true };
			return;
		}
		draftOffer = null;
		draftStore.clear().catch(() => {});
	}

	/** 草稿存的時間寫成「11/5 14:03」。 */
	function draftTime(d: Date): string {
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
	/** 解碼過的音樂檔，用 flow.audio 的 id 對應；位元組不放進流程。 */
	let audios = $state<Record<string, LoadedAudio>>({});
	const missingSegmentIds = $derived(flow ? segmentsMissingAudio(flow, Object.keys(audios)) : []);
	/** 播放頭，全域秒數。 */
	let playheadSec = $state(0);
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
		Object.fromEntries(
			(groupingAction?.members ?? []).map((m) => {
				const n = m.squad ? squadNumber(groupingAction!, m.squad) : 0;
				return [m.memberId, n ? { text: String(n), color: squadColor(n) } : { text: '?', color: NO_SQUAD_COLOR }];
			})
		)
	);
	/** 右邊欄開著哪一頁：動作（選人＋動作表單）或隊員名單。 */
	let inspectorTab = $state<'action' | 'members'>('action');
	/** 主畫面：編排（場地、右邊欄、時間軸）或練習（記成功率）。練習時編排的東西藏起來（不拆掉，場地、時間軸的縮放還在）。 */
	let view = $state<'edit' | 'practice'>('edit');
	/** 練習記在哪一天：預設今天，可以改（練完補打）；切換編排、練習時留著，不存進流程檔。 */
	let practiceDate = $state(localDate());
	/** 第幾份打開的流程（開檔、新建、救回草稿各算一次）；練習畫面照這個重開。 */
	let opened = $state(0);

	/** 切到編排或練習。練習時不放音樂，先停下來。 */
	function setView(next: 'edit' | 'practice') {
		if (next === 'practice') pause();
		view = next;
	}

	/** 整個流程的撞位；只跟著流程重算，播放頭動不用重算。 */
	const allClashes = $derived(flow ? clashes(flow) : []);

	/**
	 * 場上的影子、走位線和撞位：播放頭在站位 B 上（不是開頭那張）畫上一張的影子和這段的走位線、撞位；
	 * 在兩張站位中間只畫這段的走位線和撞位；開頭那張、最後一張之後都不畫。
	 */
	const trail = $derived.by(() => {
		const none = { ghosts: {} as Record<string, Position>, walks: [] as FormationWalk[], clashes: [] as Clash[] };
		if (!flow) return none;
		const on = formationAt(flow, playheadSec);
		const i = on
			? flow.formations.indexOf(on)
			: formationTimes(flow).findIndex((t) => t.sec > playheadSec);
		if (i <= 0) return none;
		return {
			ghosts: on ? flow.formations[i - 1].pos : none.ghosts,
			walks: formationWalks(flow, flow.formations[i].id),
			clashes: allClashes.filter((c) => c.formationId === flow!.formations[i].id)
		};
	});

	/** 播放頭的位置拆成段名和段內位置，上方列分開排大小字。 */
	const position = $derived.by(() => {
		const text = flow ? positionText(flow, playheadSec) : '';
		const cut = text.indexOf(' ', text.indexOf(' ') + 1);
		return cut === -1 ? null : { segment: text.slice(0, cut), at: text.slice(cut + 1) };
	});

	/** 秒數寫成「1:05.3」。 */
	function clock(sec: number): string {
		const m = Math.floor(sec / 60);
		const s = (sec - m * 60).toFixed(1).padStart(4, '0');
		return `${m}:${s}`;
	}

	let playing = $state(false);
	let metronome = $state(true);
	/** 延遲校正（毫秒）：存在瀏覽器，不進流程檔。 */
	let latencyMs = $state(loadLatencyMs());
	let player: Player | null = null;

	function getPlayer(): Player {
		player ??= createPlayer(createEngine((id) => audios[id]?.buffer));
		return player;
	}

	function seek(f: Flow, sec: number) {
		playheadSec = Math.min(Math.max(sec, 0), totalSeconds(f));
		if (playing) play(f);
	}

	/** 從播放頭開始播；已經播完就從頭。一定由按鈕或空白鍵觸發。 */
	function play(f: Flow) {
		playheadSec = playStartSec(f, playheadSec);
		getPlayer().start(playbackPlan(f, playheadSec), { fromSec: playheadSec, metronome });
		if (!playing) {
			playing = true;
			requestAnimationFrame(frame);
		}
	}

	function pause() {
		playing = false;
		player?.stop();
	}

	// 播放中改了段（換順序、刪段、改 BPM、長度，或復原這些）：已經排好的聲音是舊的，照現在的段重排。
	// 只看 segments 這個陣列換了沒，改人、改動作不會重排。
	// segments 另外 derived：flow 換了但 segments 是同一個陣列時，derived 不變，effect 不會跑。
	const segments = $derived(flow?.segments);
	$effect(() => {
		segments;
		untrack(() => {
			if (playing && flow) play(flow);
		});
	});

	function togglePlay(f: Flow) {
		if (playing) pause();
		else play(f);
	}

	/** 每一格畫面：照喇叭正在播的時間移動播放頭；播完就停。 */
	function frame() {
		if (!playing || !player) return;
		playheadSec = player.tick(latencyMs);
		if (!player.playing) playing = false;
		else requestAnimationFrame(frame);
	}

	function preview(f: Flow, segmentId: string) {
		pause();
		getPlayer().start(firstBeatPreview(f, segmentId), { fromSec: 0, metronome: true });
	}

	function setMetronome(f: Flow, on: boolean) {
		metronome = on;
		if (playing) play(f);
	}

	/** 清空、不合法或超出範圍：不改，欄位回到現在的值（不然欄位空著，實際還在用舊值）。 */
	function setLatency(input: HTMLInputElement) {
		const ms = input.valueAsNumber;
		if (!(Math.abs(ms) <= MAX_LATENCY_MS)) {
			input.value = String(latencyMs);
			return;
		}
		latencyMs = ms;
		saveLatencyMs(ms);
	}

	// ---------- 場地和時間軸的分界：拖它（或 ↑↓）改時間軸多高，存在這台電腦；雙擊回到預設 ----------
	const TIMELINE_MIN_PX = 160;
	/** 場地和上方列至少留這麼高。 */
	const FIELD_KEEP_PX = 300;
	let timelineH = $state<number | null>(loadTimelineHeight());
	let timelineHost = $state<HTMLElement>();
	let split: { y: number; h: number } | null = null;

	/** 時間軸現在多高：拖過就是拖的高度，沒拖過量畫面（量不到用預設的 30vh）。 */
	function currentTimelineH(): number {
		if (timelineH !== null) return timelineH;
		return Math.round(timelineHost?.getBoundingClientRect().height || Math.max(200, window.innerHeight * 0.3));
	}

	function setTimelineH(px: number | null) {
		timelineH =
			px === null ? null : Math.round(Math.min(Math.max(px, TIMELINE_MIN_PX), window.innerHeight - FIELD_KEEP_PX));
		saveTimelineHeight(timelineH);
	}

	function splitDown(e: PointerEvent) {
		if (e.button !== 0) return;
		split = { y: e.clientY, h: currentTimelineH() };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function splitMove(e: PointerEvent) {
		if (split) setTimelineH(split.h + split.y - e.clientY);
	}

	function splitKey(e: KeyboardEvent) {
		const step = { ArrowUp: 24, ArrowDown: -24 }[e.key];
		if (!step) return;
		e.preventDefault();
		setTimelineH(currentTimelineH() + step);
	}

	// ---------- 場地和右邊欄的分界：沒拖過時自動分（場地吃得到的寬度給場地，剩下給右邊欄）；
	// 拖它（或 ←→）自己定寬度，存在這台電腦；雙擊回到自動 ----------
	let inspectorW = $state<number | null>(loadInspectorWidth());
	let windowW = $state(0);
	let fieldHostH = $state(0);
	let colSplit: { x: number; w: number } | null = null;

	const fieldAspect = $derived.by(() => {
		if (!flow) return 1;
		const v = fullView(flow.field);
		return v.width / v.height;
	});
	/** 右邊欄現在多寬。 */
	const inspectorPx = $derived(
		inspectorW === null
			? autoInspectorWidth(windowW, fieldHostH, fieldAspect)
			: clampInspectorWidth(inspectorW, windowW)
	);

	/** 量場地那一欄多高（視窗或時間軸變了就重量）。jsdom 沒有 ResizeObserver，測試裡就不量。 */
	function watchFieldHostH(el: HTMLElement) {
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => (fieldHostH = el.clientHeight));
		ro.observe(el);
		return () => ro.disconnect();
	}

	function setInspectorW(px: number | null) {
		inspectorW = px === null ? null : clampInspectorWidth(px, window.innerWidth);
		saveInspectorWidth(inspectorW);
	}

	function colSplitDown(e: PointerEvent) {
		if (e.button !== 0) return;
		colSplit = { x: e.clientX, w: inspectorPx };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function colSplitMove(e: PointerEvent) {
		if (colSplit) setInspectorW(colSplit.w + colSplit.x - e.clientX);
	}

	function colSplitKey(e: KeyboardEvent) {
		const step = { ArrowLeft: 24, ArrowRight: -24 }[e.key];
		if (!step) return;
		e.preventDefault();
		setInspectorW(inspectorPx + step);
	}


	/**
	 * 換成另一支流程（新建、開檔、救回草稿）：畫面回到流程開頭、對話框都關掉。
	 * 選取、提示由 session 清掉。
	 */
	function startFlow(
		f: Flow,
		from: 'file' | 'draft' | 'new',
		loaded: Record<string, LoadedAudio> = {},
		fileSaver: FileSaver | null = null
	) {
		pause();
		// 剛建好的不算未存（沒改過就換別的不用問），但不在檔案裡，照樣存草稿
		session.open(f, from !== 'draft');
		onDisk = from === 'file';
		typing = false;
		opened++;
		saver = fileSaver;
		audios = loaded;
		openError = '';
		playheadSec = 0;
		openSegmentId = null;
		settingsOpen = false;
		printOpen = false;
		// 還沒有隊員的流程先開名單，有人了才開動作
		inspectorTab = f.members.length ? 'action' : 'members';
	}

	function undo() {
		if (session.undo()) restore(session.flow!);
	}

	function redo() {
		if (session.redo()) restore(session.flow!);
	}

	/** 復原、重做換上的流程：播放頭和開著的段設定可能指到已經不在的段（選取、提示由 session 處理）。 */
	function restore(f: Flow) {
		playheadSec = Math.min(playheadSec, totalSeconds(f));
		if (openSegmentId && !f.segments.some((s) => s.id === openSegmentId)) openSegmentId = null;
	}

	/** 流程用到、而且有載入的音樂檔位元組（存檔、草稿都用）。 */
	function audioBytes(f: Flow): Record<string, Uint8Array> {
		const audio: Record<string, Uint8Array> = {};
		for (const a of f.audio) if (audios[a.id]) audio[a.id] = new Uint8Array(audios[a.id].bytes);
		return audio;
	}

	/** 存成「流程名.zip」：Chrome、Edge 第一次跳存檔對話框、之後存回同一個檔；iPad 開分享選單；其他瀏覽器下載新檔。 */
	async function save() {
		if (!flow || saving) return;
		// 名字、備註這類欄位在失去焦點時才送進流程；先送出，存的才有剛打的字（iPad 點按鈕不一定會讓輸入框失去焦點）。
		(document.activeElement as HTMLElement | null)?.blur();
		const f = flow;
		saving = true;
		saver ??= createSaver();
		try {
			const fileName = flowFileName(f.name);
			const outcome = await saver.save(writeFlowFile(f, audioBytes(f)), fileName);
			if (outcome === 'cancelled') return;
			session.markSaved(f);
			onDisk = true;
			const missing = segmentsMissingAudio(f, Object.keys(audios)).length;
			session.notice = [
				outcome === 'downloaded'
					? `這個瀏覽器不能存回原檔，所以下載了一個新的「${fileName}」；用 Chrome 或 Edge 才能直接存回原檔。`
					: '',
				missing
					? `存好了，但有 ${missing} 段找不到音樂，存出來的檔裡沒有這些音樂：點紅色的段重新選檔，再存一次`
					: ''
			]
				.filter(Boolean)
				.join('；');
		} catch {
			session.notice = '存檔失敗，請再試一次';
		} finally {
			saving = false;
		}
	}

	/** 開檔：選檔欄位（Safari、iPad、Firefox）。缺的音樂照開，那一段標紅。 */
	async function open(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
	}

	/** 開檔：Chrome、Edge 不跳選檔欄位，改用 showOpenFilePicker，拿到存回那個檔的存檔薄層。 */
	async function pickOpen(e: Event) {
		if (!pickFlowFile) return;
		e.preventDefault();
		let picked: PickedFile | null;
		try {
			picked = await pickFlowFile();
		} catch {
			picked = null;
		}
		if (picked) await openBytes(new Uint8Array(await picked.file.arrayBuffer()), picked.file.name, picked.saver);
	}

	/**
	 * 打開流程檔的位元組。fileName = 從哪個檔開的（算已存）；null 是草稿救回來的，還算未存。
	 * fileSaver：存回那個檔的存檔薄層（沒有就第一次存檔時再建）。
	 */
	async function openBytes(bytes: Uint8Array, fileName: string | null, fileSaver: FileSaver | null = null) {
		const r = readFlowFile(bytes);
		if (r.kind === 'error') {
			const message = `打不開「${fileName}」：${r.message}`;
			if (flow) session.notice = message;
			else openError = message;
			return;
		}
		const loaded: Record<string, LoadedAudio> = {};
		let unreadable = false;
		for (const [id, bytes] of Object.entries(r.audio)) {
			const buffer = bytes.slice().buffer;
			try {
				loaded[id] = { bytes: buffer, ...(await decode(buffer)) };
			} catch {
				// 這個瀏覽器解不開（例：Firefox 沒有 AAC）：位元組留著，存檔時照樣存回去，只是不出聲。
				loaded[id] = { bytes: buffer, durationSec: 0, peaks: [] };
				unreadable = true;
			}
		}
		unlessUnsaved(() => {
			startFlow(r.flow, fileName === null ? 'draft' : 'file', loaded, fileSaver);
			session.notice = r.missingSegmentIds.length
				? `「${fileName ?? '草稿'}」裡少了音樂檔${missingAudioNames(r.flow, r.missingSegmentIds)}：點紅色的段重新選檔`
				: unreadable
					? '有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音'
					: '';
		});
	}

	/** 缺音樂的段用到的音樂檔名：「主歌.mp3」「副歌.mp3」。 */
	function missingAudioNames(f: Flow, segmentIds: string[]): string {
		const ids = new Set(f.segments.flatMap((s) => (s.kind === 'music' && segmentIds.includes(s.id) ? [s.audioId] : [])));
		return f.audio
			.filter((a) => ids.has(a.id))
			.map((a) => `「${a.name}」`)
			.join('');
	}

	/** 等教練決定要不要丟掉還沒存的修改：確定就做 then。 */
	let discardPending = $state.raw<{ then: () => void } | null>(null);

	/** 段設定、流程設定、八拍表、「還沒存」的問題蓋在上面：底下的編輯畫面點不到、Tab 不到，快捷鍵也不動它。 */
	const overlayOpen = $derived(!!openSegmentId || settingsOpen || printOpen || !!discardPending);

	/** 「先存檔」：存好了（沒有未存的修改）才接著做；在存檔視窗按取消或存失敗，就留在問的畫面。 */
	async function saveThenContinue() {
		const then = discardPending?.then;
		await save();
		if (session.unsaved || !discardPending) return;
		discardPending = null;
		then?.();
	}

	/** 會換掉現在的流程（開檔、新建）：有還沒存的修改就先問，確定才做。 */
	function unlessUnsaved(then: () => void) {
		// 換掉的流程是這個分頁放在草稿裡的：草稿跟著丟掉（「不存了，繼續」、剛建好沒改就新建），重新整理不會又問要不要救回。
		const go = () => {
			if (ownsDraft) draftStore.clear().catch(() => {});
			then();
		};
		if (unsaved) discardPending = { then: go };
		else go();
	}

	/** 上方列「新建」：回到新建流程的畫面。 */
	function startNew() {
		unlessUnsaved(() => {
			pause();
			session.open(null);
		});
	}

	// 改完要動播放頭的改動（拖人插站位、跟上一張一樣、挪站位）：session 說跳到哪，這裡跳。
	// 拖人那種直接停到那張（播放中照樣跟著音樂走）；挪站位跟點八拍尺一樣，播放中從那裡重播。
	$effect(() => {
		const jump = session.jump;
		if (!jump) return;
		untrack(() => {
			if (!jump.replay) playheadSec = jump.sec;
			else if (flow) seek(flow, jump.sec);
		});
	});

	/** 提示泡泡留幾毫秒就自己收掉。 */
	const NOTICE_MS = 5000;

	// 提示泡泡過幾秒自己收掉（換了一句就重算）。
	$effect(() => {
		if (!session.notice) return;
		const timer = setTimeout(() => (session.notice = ''), NOTICE_MS);
		return () => clearTimeout(timer);
	});

	/** 下一個操作（按下滑鼠、手指、鍵盤）就收掉提示泡泡；按在泡泡上（「復原」、✕）不算。先收，操作自己的提示才放得上去。 */
	function dismissNotice(e: Event) {
		if (session.notice && !(e.target as Element | null)?.closest?.('.toast')) session.notice = '';
	}

	// 在時間軸點了色條（再點選著的那條也算）：右邊欄翻到「動作」那一頁。
	$effect(() => {
		if (session.pickedAction) untrack(() => (inspectorTab = 'action'));
	});

	/** 空白鍵照瀏覽器原本的行為的東西：按得下去、選得了、打得了字的。場上的人不算（空白鍵播放）。 */
	const NATIVE_KEYS =
		'button, a[href], input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), ' +
		'[role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"], [role="menuitem"]';
	/** 打字的地方：快捷鍵（Delete、方向鍵、Home／End、數字鍵）留給它。 */
	const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

	/** 復原、重做：焦點在輸入框裡時，先把打了還沒送出的字送出去，再退回流程，欄位照退回的流程重畫。 */
	function undoKey(redoing: boolean) {
		flushPendingInput();
		flushSync();
		if (redoing) redo();
		else undo();
		flushSync();
		settlePendingInput();
	}

	function onkeydown(e: KeyboardEvent) {
		// Ctrl+S（Mac ⌘S）在輸入框裡也要能存，所以放在最前面；也擋掉瀏覽器的「另存網頁」。
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void save();
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
			// 對話框開著時只能暫停（不在對話框後面開始播）
			if (overlayOpen && !playing) return;
			e.preventDefault();
			togglePlay(flow);
			return;
		}
		// 對話框、八拍表蓋在上面時，其他快捷鍵不動到底下的編輯畫面
		if (overlayOpen || on(TYPING)) return;
		// 選單自己用方向鍵、Home／End（例：任務角色選單）時不算
		const ownKeys = '[role="combobox"], [role="listbox"], [role="radiogroup"]';
		if ((e.key === 'Home' || e.key === 'End') && !e.defaultPrevented && !on(ownKeys)) {
			e.preventDefault();
			seek(flow, e.key === 'Home' ? 0 : totalSeconds(flow));
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && session.selectedFormationId) {
			e.preventDefault();
			session.removeFormation(session.selectedFormationId);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && session.selectedActionId) {
			// Mac 的 delete 鍵送的是 Backspace
			e.preventDefault();
			removeAction(session.selectedActionId);
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
			seek(flow, stepPlayhead(flow, playheadSec, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey));
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
		inspectorTab = inspectorTab === 'action' ? 'members' : 'action';
		flushSync();
		document.getElementById(`tab-${inspectorTab}`)?.focus();
	}

	/** 兩條分界都回到預設（雙擊分界也可以，一次一條）。 */
	function resetLayout() {
		setTimelineH(null);
		setInspectorW(null);
	}

	/** 刪動作；有紀錄時核心要確認，跟拉色條一樣在場上問，確定才刪。 */
	function removeAction(id: string) {
		const f = flow;
		if (!f) return;
		// 按確定時用那時候的流程再送一次。
		session.ask.send((o: ConfirmOption = {}) => deleteAction(flow ?? f, id, o));
	}
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>
<svelte:window
	{onkeydown}
	{onbeforeunload}
	{oninput}
	onchange={sent}
	onfocusout={sent}
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
		style:--timeline-h={timelineH === null ? undefined : `clamp(${TIMELINE_MIN_PX}px, ${timelineH}px, calc(100dvh - ${FIELD_KEEP_PX}px))`}
		style:--inspector-w="{inspectorPx}px"
	>
		<!-- 提示（存檔、開檔的結果…）：編排時浮在場地上，練習時浮在練習畫面上 -->
		{#snippet noticeToast()}
			{#if session.notice}
				<div class="toast">
					<span role="status">{session.notice}</span>
					{#if session.noticeUndo}
						<button type="button" class="ghost undo" aria-label="復原刪掉的站位" onclick={undo}>復原</button>
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
				{#if unsaved}<span class="unsaved" title="有還沒存的修改（⌘S／Ctrl+S 存檔）">未存</span>{/if}
				<div class="view" role="group" aria-label="編排｜練習">
					<button type="button" aria-pressed={view === 'edit'} onclick={() => setView('edit')}>編排</button>
					<button type="button" aria-pressed={view === 'practice'} onclick={() => setView('practice')}>練習</button>
				</div>
				<!-- 放在名字這一欄：右邊的按鈕已經滿了，再加會壓到中間的播放區 -->
				<a class="btn ghost guide-link" href={guideHref} target="_blank" rel="noopener" title="使用說明"
					><Icon name="help" /><span class="narrow-hide">使用說明</span></a
				>
			</div>

			<div class="transport" hidden={view === 'practice'}>
				<button
					type="button"
					class="play"
					class:on={playing}
					aria-label={playing ? '暫停' : '播放'}
					title="空白鍵也可以播放／暫停"
					onclick={() => flow && togglePlay(flow)}><Icon name={playing ? 'pause' : 'play'} size={18} /></button
				>
				<div class="board">
					<span class="pos" aria-label="目前位置"
						>{#if position}<span class="pos-seg">{position.segment}</span>
							<span class="pos-at">{position.at}</span>{:else}<span class="pos-seg">還沒有段</span>{/if}</span
					>
					<span class="clock">{clock(playheadSec)} <i>/ {clock(totalSeconds(flow))}</i></span>
				</div>
				<label class="toggle" title="播放時每拍響一聲">
					<input
						type="checkbox"
						checked={metronome}
						onchange={(e) => flow && setMetronome(flow, e.currentTarget.checked)}
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
						value={latencyMs}
						onchange={(e) => setLatency(e.currentTarget)}
					/>
				</label>
			</div>

			<div class="actions">
				<!-- 練習時沒有復原、重做：復原只退編排的修改，在練習畫面看不到退了什麼，還可能弄掉紀錄 -->
				{#if view === 'edit'}
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
					<span class="sep" aria-hidden="true"></span>
				{/if}
				<button type="button" class="ghost" title="八拍表" onclick={() => (printOpen = true)}
					><Icon name="print" /><span class="narrow-hide">八拍表</span></button
				>
				{#if view === 'edit'}
					<button type="button" class="ghost" title="流程設定" onclick={() => (settingsOpen = true)}
						><Icon name="settings" /><span class="narrow-hide">流程設定</span></button
					>
				{/if}
				<span class="sep" aria-hidden="true"></span>
				<label class="open btn ghost"><Icon name="open" />開啟<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
				<button type="button" class="ghost" onclick={startNew}><Icon name="new" />新建</button>
				<button type="button" class="primary save" title="⌘S／Ctrl+S" onclick={save}><Icon name="save" />存檔</button>
			</div>
		</header>

		<main class="field-host" hidden={view === 'practice'} {@attach watchFieldHostH}>
			<Field
				field={flow.field}
				members={flow.members}
				markers={memberMarkers(flow)}
				positions={positionsAt(flow, playheadSec)}
				raised={raisedAt(flow, playheadSec)}
				{playheadSec}
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
					{#if touchScreen || timelineH !== null || inspectorW !== null}
						<div class="select-tools">
							{#if touchScreen}
								<label class="toggle-btn" title="打開後，場上點人、框選、點泳道名字都是加選或拿掉（跟按著 Shift 一樣）">
									<input type="checkbox" bind:checked={session.multiSelect} />多選
								</label>
								<button type="button" disabled={!session.anySelected} onclick={() => session.clearSelection()}>取消選取</button>
							{/if}
							{#if timelineH !== null || inspectorW !== null}
								<button type="button" class="ghost" onclick={resetLayout}>版面回原狀</button>
							{/if}
						</div>
					{/if}
					{#if flow}
						{@const now = currentFormation(flow, playheadSec)}
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
						{@const stacked = stackedMembers(flow.members, positionsAt(flow, playheadSec))}
						{#if stacked.length}
							<p class="hint-warn" role="note">
								{stacked.map((g) => g.map((m) => m.name).join('、')).join('；')} 疊在同一點：被蓋住的人看不到也點不到，拖開一點比較好
							</p>
						{/if}
						<CueOverlay {flow} {playheadSec} />
					{/if}
				{/snippet}
				{#snippet railBottom()}
					{#if flow?.members.length}
						<FormationEditor {playheadSec} />
					{/if}
				{/snippet}
			{#if flow.members.length === 0}
				<div class="field-empty">
					<b>場上還沒有人</b>
					<span>到右邊的「隊員」加人，他們會排進場地中間的空格點（場地站滿了才排到場外），可以直接拖。</span>
				</div>
			{/if}
			{#if session.ask.question}
				<div class="toast-confirm">
					<ConfirmList ask={session.ask} />
				</div>
			{/if}
			{@render noticeToast()}
			</Field>
		</main>

		<aside class="inspector" hidden={view === 'practice'}>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (可以聚焦、用 ←→ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
			<div
				class="col-split"
				role="separator"
				aria-orientation="vertical"
				aria-label="場地和右邊欄的分界"
				aria-valuenow={inspectorPx}
				aria-valuemin={INSPECTOR_MIN_PX}
				tabindex="0"
				title="拖這裡調整右邊欄的寬度（雙擊或按場地左邊的「版面回原狀」回到自動）"
				onpointerdown={colSplitDown}
				onpointermove={colSplitMove}
				onpointerup={() => (colSplit = null)}
				onpointercancel={() => (colSplit = null)}
				onkeydown={colSplitKey}
				ondblclick={() => setInspectorW(null)}
			></div>
			<!-- svelte-ignore a11y_interactive_supports_focus (焦點在裡面的分頁上，←→ 從分頁冒上來；分頁列本身不用停) -->
			<div class="tabs" role="tablist" aria-label="右邊欄" onkeydown={tabKey}>
				<button
					type="button"
					role="tab"
					id="tab-action"
					aria-selected={inspectorTab === 'action'}
					aria-controls="panel-action"
					onclick={() => (inspectorTab = 'action')}><Icon name="bolt" />動作</button
				>
				<button
					type="button"
					role="tab"
					id="tab-members"
					aria-selected={inspectorTab === 'members'}
					aria-controls="panel-members"
					onclick={() => (inspectorTab = 'members')}
					><Icon name="people" />隊員<span class="count">{flow.members.length}</span></button
				>
			</div>
			<div class="panel" id="panel-action" role="tabpanel" aria-labelledby="tab-action" hidden={inspectorTab !== 'action'}>
				<MemberPicker {playheadSec} />
				<WalkForm {playheadSec} />
				<ActionForm {playheadSec} {cellAt} />
			</div>
			<div class="panel" id="panel-members" role="tabpanel" aria-labelledby="tab-members" hidden={inspectorTab !== 'members'}>
				<MemberPanel />
			</div>
		</aside>

		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (可以聚焦、用 ↑↓ 調的分界，WAI-ARIA 的 separator 就是這樣用) -->
		<div
			class="split"
			hidden={view === 'practice'}
			role="separator"
			aria-orientation="horizontal"
			aria-label="場地和時間軸的分界"
			aria-valuenow={timelineH ?? currentTimelineH()}
			aria-valuemin={TIMELINE_MIN_PX}
			tabindex="0"
			title="拖這裡調整場地和時間軸的高度（雙擊或按場地左邊的「版面回原狀」回到預設）"
			onpointerdown={splitDown}
			onpointermove={splitMove}
			onpointerup={() => (split = null)}
			onpointercancel={() => (split = null)}
			onkeydown={splitKey}
			ondblclick={() => setTimelineH(null)}
		></div>

		<div class="timeline-host" hidden={view === 'practice'} bind:this={timelineHost}>
			<Timeline
				{playheadSec}
				onseek={(sec) => flow && seek(flow, sec)}
				onopensegment={(id) => (openSegmentId = id)}
				{missingSegmentIds}
			/>
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
	<!-- iPad 拿直的：場地會被擠到看不見，請教練轉成橫的（只在觸控螢幕顯示） -->
	<div class="cover-hint rotate-hint">
		<Icon name="fit" size={28} />
		<b>請把 iPad 轉成橫的</b>
		<span>編輯畫面要橫著放，場地和時間軸才放得下。</span>
	</div>
	<!-- 視窗太窄（手機、縮小的視窗）：場地會被右邊欄擠到看不見、上方列的按鈕疊在一起。排在後面，手機拿直的時蓋過上面那張 -->
	<div class="cover-hint narrow-hint">
		<Icon name="fit" size={28} />
		<b>視窗太窄了</b>
		<span>編輯畫面要至少 760 像素寬，場地和右邊欄才放得下。請用電腦，或把平板轉成橫的。</span>
	</div>
	{#if openSegmentId}
		<SegmentSettings
			segmentId={openSegmentId}
			{audios}
			{decode}
			{waveXToSec}
			onaudioload={(id, audio) => (audios[id] = audio)}
			onpreview={(id) => flow && preview(flow, id)}
			{playing}
			onpause={pause}
			onclose={() => (openSegmentId = null)}
		/>
	{/if}
	{#if settingsOpen}
		<FlowSettings onclose={() => (settingsOpen = false)} />
	{/if}
	{#if printOpen}
		<PrintSheet {flow} onclose={() => (printOpen = false)} />
	{/if}
	{#if discardPending}
		<div class="backdrop discard">
			<div class="discard-box">
				<ConfirmList
					message={`「${flow.name}」還沒存，改的東西會不見。`}
					items={[]}
					confirmLabel="不存了，繼續"
					onconfirm={() => {
						const then = discardPending?.then;
						discardPending = null;
						then?.();
					}}
					extra={{ label: '先存檔', onclick: saveThenContinue }}
					oncancel={() => (discardPending = null)}
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
			{#if draftOffer}
				<div class="draft-offer" role="alertdialog" aria-labelledby="draft-offer-text">
					<p id="draft-offer-text">
						上次編的「{draftOffer.name}」還沒存，要救回嗎？{#if draftOffer.savedAt}（{draftTime(draftOffer.savedAt)} 存的草稿）{/if}
					</p>
					{#if draftOffer.busy}<p class="error">另一個分頁正在編輯這份草稿，所以沒有丟掉。</p>{/if}
					<div class="row">
						<button type="button" class="primary" onclick={() => draftOffer && restoreDraft(draftOffer.bytes)}
							>救回</button
						>
						<button type="button" onclick={discardDraft}>丟掉</button>
					</div>
				</div>
			{:else}
				<NewFlowForm oncreate={(f) => startFlow(f, 'new')} />
				<div class="home-open">
					<span>已經有流程檔？</span>
					<label class="open btn"><Icon name="open" />開啟流程檔<input type="file" accept=".zip" onclick={pickOpen} onchange={open} /></label>
				</div>
				{#if openError}<p class="error" role="alert">{openError}</p>{/if}
			{/if}
		</section>
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
	.unsaved {
		flex: none;
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
	/* 放在場地下方，不蓋住上方的條號。 */
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
	.toast-confirm {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		width: min(420px, calc(100% - 32px));
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
	/* screen：列印八拍表時（紙是直的）不能印到它。 */
	@media screen and (pointer: coarse) and (orientation: portrait) {
		.rotate-hint {
			display: grid;
		}
	}
	@media screen and (max-width: 759px) {
		.narrow-hint {
			display: grid;
		}
	}

	/* 窄一點的視窗：延遲校正只留輸入框（名字還在，滑過去看得到說明），不整個藏起來。
	   上方列多了「編排｜練習」，所以從 1440px 就開始收。 */
	@media (max-width: 1440px) {
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
		/* 使用說明、復原、重做、八拍表、流程設定只留圖示，右邊的按鈕才擠得下；讀屏照樣讀得到名字 */
		.narrow-hide {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* 再窄就一行放不下：播放區換到第二行，名字和按鈕留在第一行 */
	@media (max-width: 1140px) {
		.topbar {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.transport {
			grid-row: 2;
			grid-column: 1 / -1;
			justify-content: center;
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
	.intro h1 {
		font-size: 40px;
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
	.draft-offer {
		display: grid;
		gap: 16px;
		padding: 24px;
		background: var(--surface);
		border-radius: 14px;
		box-shadow: var(--shadow-pop);
		font-size: 15px;
	}
	.draft-offer .row {
		display: flex;
		gap: 8px;
	}
	@media (max-width: 760px) {
		.home {
			grid-template-columns: 1fr;
			gap: 28px;
			padding: 32px 16px;
		}
		.intro h1 {
			font-size: 30px;
		}
	}
</style>
