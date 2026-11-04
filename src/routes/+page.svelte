<script lang="ts">
	import {
		addSegment,
		currentFormation,
		deleteAction,
		deleteFormation,
		firstBeatPreview,
		formationAt,
		formationTimes,
		formationWalks,
		matchPrevious,
		memberMarkers,
		moveFormation,
		moveFormationHint,
		moveMembers,
		moveTargetText,
		parseTime,
		playbackPlan,
		playStartSec,
		NO_SQUAD_COLOR,
		positionText,
		positionsAt,
		raisedAt,
		readFlowFile,
		renameFormation,
		segmentsMissingAudio,
		squadColor,
		timeRuleWarnings,
		timeText,
		totalSeconds,
		writeFlowFile,
		type ConfirmOption,
		type Flow,
		type Formation,
		type FormationWalk,
		type MoveResult,
		type Position,
		type SegmentKind,
		type TimePosition
	} from '#lib/core';
	import { decodeAudio, type DecodedAudio, type LoadedAudio } from '#lib/audio/decode.js';
	import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
	import { createPlayer, type Player } from '#lib/audio/player.js';
	import { createIndexedDbDraftStore, type DraftStore } from '#lib/file/draft.js';
	import { createBrowserSaver, type FileSaver } from '#lib/file/save.js';
	import { EditorSession, setEditorSession } from '#lib/editor-session.svelte.js';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		loadInspectorWidth,
		loadLatencyMs,
		loadTimelineHeight,
		saveInspectorWidth,
		saveLatencyMs,
		saveTimelineHeight
	} from '#lib/local-settings.js';
	import { autoInspectorWidth, clampInspectorWidth, INSPECTOR_MIN_PX } from '#lib/editor-layout.js';
	import { setUnsavedChanges } from '#lib/unsaved.js';
	import { localDate } from '#lib/local-date.js';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import ConfirmList from '#lib/components/ConfirmList.svelte';
	import CueOverlay from '#lib/components/CueOverlay.svelte';
	import Field, { fullView } from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
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
		/** 解碼音樂檔；測試換成假的（jsdom 沒有 Web Audio）。 */
		decode?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
		/** 草稿存在哪裡（預設 IndexedDB）；測試換成假的（jsdom 沒有 IndexedDB）。 */
		draftStore?: DraftStore;
		/** 編輯 session（流程和復原）；測試放一個帶好流程的進來，再讀它的流程。沒給就自己建。 */
		session?: EditorSession;
	}

	let {
		createEngine = createWebAudioEngine,
		createSaver = createBrowserSaver,
		decode = decodeAudio,
		draftStore = createIndexedDbDraftStore(),
		session = new EditorSession()
	}: Props = $props();
	// session 一開始給了就不換：放進 context 的就是這一個。
	// svelte-ignore state_referenced_locally
	setEditorSession(session);

	/** 使用說明開在新分頁：編輯畫面留著，還沒存的修改不會因為看說明而不見。 */
	const guideHref = resolve('/guide');

	const flow = $derived(session.flow);
	const unsaved = $derived(session.unsaved);
	$effect(() => setUnsavedChanges(unsaved));
	/** 存檔薄層，一支流程一個（記得存到哪個檔）：第一次存檔才建，換流程就丟掉。 */
	let saver: FileSaver | null = null;
	let saving = false;
	/** 首頁開檔失敗的原因（編輯中失敗就放在上方列的 notice）。 */
	let openError = $state('');
	/** 打開時找到的草稿，等教練選救回或丟掉。 */
	let draftOffer = $state.raw<{ bytes: Uint8Array; name: string } | null>(null);

	/** 讀過草稿了：在這之前不自動存，免得蓋掉還沒問過的草稿。 */
	let draftChecked = $state(false);

	onMount(async () => {
		let bytes: Uint8Array | null = null;
		try {
			bytes = await draftStore.load();
		} catch {
			// 讀不到草稿就當作沒有
		}
		const r = bytes && readFlowFile(bytes);
		// 等讀草稿的時候教練已經開始編了：不打斷他
		if (bytes && r && r.kind === 'ok' && !flow) draftOffer = { bytes, name: r.flow.name };
		draftChecked = true;
	});

	/**
	 * 編輯時自動存草稿：停手 1 秒才存（整個 zip 含音樂，不要每一下都存）。
	 * 存成流程檔或剛開流程檔（沒有未存的修改）就丟掉草稿：檔案裡已經有了，下次打開不用問。
	 */
	const DRAFT_DELAY_MS = 1000;
	$effect(() => {
		if (!draftChecked || !flow) return;
		const f = flow;
		const keep = unsaved;
		const timer = setTimeout(() => {
			const done = keep ? draftStore.save(writeFlowFile(f, audioBytes(f))) : draftStore.clear();
			done.catch(() => {});
		}, DRAFT_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function restoreDraft(bytes: Uint8Array) {
		draftOffer = null;
		await openBytes(bytes, false);
	}

	function discardDraft() {
		draftOffer = null;
		draftStore.clear().catch(() => {});
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
			(groupingAction?.members ?? []).map((m) => [
				m.memberId,
				m.squad ? { text: String(m.squad), color: squadColor(m.squad) } : { text: '?', color: NO_SQUAD_COLOR }
			])
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

	/**
	 * 場上的影子和走位線：播放頭在站位 B 上（不是開頭那張）畫上一張的影子和這段的走位線；
	 * 在兩張站位中間只畫這段的走位線；開頭那張、最後一張之後都不畫。
	 */
	const trail = $derived.by(() => {
		const none = { ghosts: {} as Record<string, Position>, walks: [] as FormationWalk[] };
		if (!flow) return none;
		const on = formationAt(flow, playheadSec);
		const i = on
			? flow.formations.indexOf(on)
			: formationTimes(flow).findIndex((t) => t.sec > playheadSec);
		if (i <= 0) return none;
		return {
			ghosts: on ? flow.formations[i - 1].pos : none.ghosts,
			walks: formationWalks(flow, flow.formations[i].id)
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

	function setLatency(ms: number) {
		if (!Number.isFinite(ms)) return;
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
	function startFlow(f: Flow, loaded: Record<string, LoadedAudio> = {}, saved = false) {
		pause();
		session.open(f, saved);
		opened++;
		saver = null;
		audios = loaded;
		openError = '';
		playheadSec = 0;
		openSegmentId = null;
		settingsOpen = false;
		printOpen = false;
		// 還沒有隊員的流程先開名單，有人了才開動作
		inspectorTab = f.members.length ? 'action' : 'members';
	}

	/**
	 * 改流程的唯一入口：交給 session 的「改」，算復原的一步（拖人連帶插站位、往後帶也只呼叫一次）。
	 * 換成另一支流程（開檔、新建、救回草稿）不走這裡，走 startFlow。
	 */
	function change(f: Flow) {
		session.change(f);
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
			const outcome = await saver.save(writeFlowFile(f, audioBytes(f)), `${f.name}.zip`);
			if (outcome === 'cancelled') return;
			session.markSaved(f);
			session.notice =
				outcome === 'downloaded'
					? `這個瀏覽器不能存回原檔，所以下載了一個新的「${f.name}.zip」；用 Chrome 或 Edge 才能直接存回原檔。`
					: '';
		} catch {
			session.notice = '存檔失敗，請再試一次';
		} finally {
			saving = false;
		}
	}

	/** 開檔：四家瀏覽器都用選檔。缺的音樂照開，那一段標紅。 */
	async function open(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await openBytes(new Uint8Array(await file.arrayBuffer()), true);
	}

	/** 打開流程檔的位元組。fromFile = 從檔案開（算已存）；草稿救回來的還算未存。 */
	async function openBytes(bytes: Uint8Array, fromFile: boolean) {
		const r = readFlowFile(bytes);
		if (r.kind === 'error') {
			if (flow) session.notice = r.message;
			else openError = r.message;
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
			startFlow(r.flow, loaded, fromFile);
			session.notice = r.missingSegmentIds.length
				? '有段找不到音樂：點紅色的段重新選檔'
				: unreadable
					? '有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音'
					: '';
		});
	}

	/** 等教練決定要不要丟掉還沒存的修改：確定就做 then。 */
	let discardPending = $state.raw<{ then: () => void } | null>(null);

	/** 會換掉現在的流程（開檔、新建）：有還沒存的修改就先問，確定才做。 */
	function unlessUnsaved(then: () => void) {
		if (unsaved) discardPending = { then };
		else then();
	}

	/** 上方列「新建」：回到新建流程的畫面。 */
	function startNew() {
		unlessUnsaved(() => {
			pause();
			session.open(null);
		});
	}

	function add(f: Flow, kind: SegmentKind) {
		const r = addSegment(f, kind);
		if (r.kind !== 'ok') return;
		change(r.flow);
		openSegmentId = r.id;
	}

	/** 拖人：改播放頭這一拍的站位（沒有就插一張）。播放頭停到那張站位上，場上才是剛放的位置。 */
	function move(moves: Record<string, Position>) {
		if (!flow) return;
		const r = moveMembers(flow, playheadSec, moves);
		if (r.kind !== 'ok') return void (session.notice = r.message);
		moved(r);
	}

	/** ① 跟上一張一樣：選到的人改成上一張站位的位置（沒有站位就先插一張），提示跟拖人一樣。 */
	function matchPrev() {
		if (!flow) return;
		const r = matchPrevious(flow, playheadSec, session.selectedMemberIds);
		if (r.kind !== 'ok') return void (session.notice = r.message);
		moved(r);
	}

	/** 幫播放頭所在的站位取名；名字沒變就不記一步復原。 */
	function renameHere(formationId: string, name: string) {
		if (!flow) return;
		const before = flow.formations.find((f) => f.id === formationId)?.name ?? '';
		if (name.trim() === before) return;
		const r = renameFormation(flow, formationId, name);
		if (r.kind !== 'ok') return void (session.notice = r.message);
		change(r.flow);
	}

	/** 拖人、跟上一張一樣改好之後：換流程、說插了站位或往後帶了幾張、播放頭停到改的那張。 */
	function moved(r: { flow: Flow } & MoveResult) {
		change(r.flow);
		const said = [
			r.inserted && '插了一張站位，大家的位置自動帶入',
			r.carried > 0 && `後面 ${r.carried} 張站位也跟著改了`
		];
		session.notice = said.filter(Boolean).join('；');
		playheadSec = r.sec;
	}

	/**
	 * 挪站位（拖縮圖、打站位時間）：被擋就說原因。挪了就提示走位被壓短的人數，
	 * 選著這張、播放頭跳到新的站位時間（左邊欄的站位時間框還在）。
	 */
	function moveFormationTo(id: string, to: TimePosition) {
		const f = flow;
		if (!f) return;
		// 被擋時縮圖已經彈回原位，還原不用再做什麼。
		session.ask.send(() => moveFormation(f, id, to), {
			revert: () => {},
			done: (r) => {
				session.notice = r.squeezed > 0 ? `有 ${r.squeezed} 人的走位被壓短` : '';
				session.selectFormation(id);
				seek(r.flow, r.sec);
			}
		});
	}

	/**
	 * 左邊欄「站位時間」框改了：寫法跟出發、到達一樣，看得懂就挪過去。
	 * 框先變回原本的 text：挪成功時跟著流程換成新的站位時間，看不懂或被擋就留在原本的。
	 */
	function retimeHere(box: HTMLInputElement, formation: Formation, text: string) {
		if (!flow) return;
		// 播放頭停在這張上、框能打字，表示不是開頭那張，一定有段。
		const to = parseTime(flow, formation.segmentId!, box.value);
		box.value = text;
		if (!to) return void (session.notice = '站位時間看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）');
		moveFormationTo(formation.id, to);
	}

	/**
	 * 左邊欄名稱框、站位時間框的按鍵：Enter 離開框（送出），Esc 變回 original 再離開。
	 * 中文輸入法還在選字時按的 Enter / Esc 是給輸入法的；這時離開輸入框，字會重複（Safari 選字時 keyCode 是 229）。
	 */
	function railBoxKeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }, original: string) {
		if (e.isComposing || e.keyCode === 229) return;
		if (e.key === 'Enter') e.currentTarget.blur();
		if (e.key === 'Escape') {
			e.currentTarget.value = original;
			e.currentTarget.blur();
		}
	}

	function removeFormation(id: string) {
		if (!flow) return;
		const r = deleteFormation(flow, id);
		if (r.kind !== 'ok') return void (session.notice = r.message);
		change(r.flow);
		session.notice = '';
	}

	function onkeydown(e: KeyboardEvent) {
		// Ctrl+S（Mac ⌘S）在輸入框裡也要能存，所以放在最前面；也擋掉瀏覽器的「另存網頁」。
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void save();
			return;
		}
		// Esc 先關掉開著的段設定、流程設定、八拍表
		if (e.key === 'Escape' && (openSegmentId || settingsOpen || printOpen)) {
			openSegmentId = null;
			settingsOpen = false;
			printOpen = false;
			return;
		}
		// 八拍表蓋在上面時，快捷鍵不動到底下的編輯畫面
		if (!flow || printOpen) return;
		if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
		const key = e.key.toLowerCase();
		if ((e.ctrlKey || e.metaKey) && (key === 'z' || (key === 'y' && e.ctrlKey))) {
			e.preventDefault();
			if (key === 'z' && !e.shiftKey) undo();
			else redo();
		} else if (view === 'practice') {
			// 練習時只留存檔、復原、重做：空白鍵留給記號按鈕，Delete 不能刪到藏起來的動作、站位
			return;
		} else if (e.key === ' ') {
			if (e.repeat) return;
			// 不讓焦點所在的按鈕也被空白鍵按到
			e.preventDefault();
			togglePlay(flow);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && session.selectedFormationId) {
			e.preventDefault();
			removeFormation(session.selectedFormationId);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && session.selectedActionId) {
			// Mac 的 delete 鍵送的是 Backspace
			e.preventDefault();
			removeAction(session.selectedActionId);
		} else if (e.key === 'Escape') {
			session.clearSelection();
		} else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// 分組：選好人按 1–9 放進那組、0 拿出組。任務角色選單也用數字鍵，焦點在那裡不算。
			if ((e.target as Element | null)?.closest?.('[role="combobox"]')) return;
			if (session.squadKey(Number(e.key))) e.preventDefault();
		}
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

	const selectMembers = (ids: string[]) => session.selectMembers(ids);
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>
<svelte:window {onkeydown} bind:innerWidth={windowW} />

{#if flow}
	{@const warnings = timeRuleWarnings(flow)}
	{@const match = matchPrevious(flow, playheadSec, session.selectedMemberIds)}
	{@const matchBlocked = match.kind === 'blocked' ? match.message : ''}
	<div
		class="editor"
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
					<button type="button" class="ghost icon" aria-label="收起提示" onclick={() => (session.notice = '')}
						><Icon name="close" size={14} /></button
					>
				</div>
			{/if}
		{/snippet}
		<header class="topbar">
			<div class="title">
				<b>{flow.name}</b>
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
						value={latencyMs}
						onchange={(e) => setLatency(e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>

			<div class="actions">
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
				<button type="button" class="ghost" title="八拍表" onclick={() => (printOpen = true)}
					><Icon name="print" /><span class="narrow-hide">八拍表</span></button
				>
				{#if view === 'edit'}
					<button type="button" class="ghost" title="流程設定" onclick={() => (settingsOpen = true)}
						><Icon name="settings" /><span class="narrow-hide">流程設定</span></button
					>
				{/if}
				<span class="sep" aria-hidden="true"></span>
				<label class="open btn ghost"><Icon name="open" />開啟<input type="file" accept=".zip" onchange={open} /></label>
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
				selected={session.selectedMemberIds}
				multi={session.multiSelect}
				ghosts={trail.ghosts}
				walks={trail.walks}
				onmove={move}
				onselect={selectMembers}
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
					{#if flow}<CueOverlay {flow} {playheadSec} />{/if}
				{/snippet}
				{#snippet railBottom()}
					{#if flow?.members.length}
						<div class="match-prev">
							<button type="button" disabled={!!matchBlocked} onclick={matchPrev}>跟上一張一樣</button>
							{#if matchBlocked}<span>{matchBlocked}</span>{/if}
						</div>
						{@const here = formationAt(flow, playheadSec)}
						<!-- 開頭那張還沒有段時 segmentId 是 null，框裡就空著（反正不能挪）。 -->
						{@const hereTime = here?.segmentId ? timeText(flow, here.segmentId, here as TimePosition) : ''}
						<div class="here" class:on={!!here}>
							<p class="move-target">{moveTargetText(flow, playheadSec)}</p>
							{#if here}
								{#key here.id}
									<input
										class="formation-name"
										aria-label="站位名稱"
										placeholder="幫這張站位取名（可不填）"
										value={here.name ?? ''}
										onkeydown={(e) => railBoxKeydown(e, here.name ?? '')}
										onchange={(e) => renameHere(here.id, e.currentTarget.value)}
									/>
									<label class="formation-time">
										<span>站位時間</span>
										<input
											value={hereTime}
											disabled={here === flow.formations[0]}
											onkeydown={(e) => railBoxKeydown(e, hereTime)}
											onchange={(e) => retimeHere(e.currentTarget, here, hereTime)}
										/>
									</label>
									<p class="time-hint">{moveFormationHint(flow, here.id)}</p>
								{/key}
							{/if}
						</div>
					{/if}
				{/snippet}
			{#if flow.members.length === 0}
				<div class="field-empty">
					<b>場上還沒有人</b>
					<span>到右邊的「隊員」加人，他們會出現在場上，可以直接拖。</span>
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
			<div class="tabs" role="tablist" aria-label="右邊欄">
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
				<MemberPicker {flow} {playheadSec} selected={session.selectedMemberIds} onselect={selectMembers} />
				<WalkForm {flow} {playheadSec} selectedMemberIds={session.selectedMemberIds} onchange={change} />
				<ActionForm {playheadSec} />
			</div>
			<div class="panel" id="panel-members" role="tabpanel" aria-labelledby="tab-members" hidden={inspectorTab !== 'members'}>
				<MemberPanel {flow} onchange={change} />
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
				{flow}
				{playheadSec}
				onseek={(sec) => flow && seek(flow, sec)}
				onaddsegment={(kind) => flow && add(flow, kind)}
				onopensegment={(id) => (openSegmentId = id)}
				{missingSegmentIds}
				selectedFormationId={session.selectedFormationId}
				onselectformation={(id, sec) => {
					session.selectFormation(id);
					if (flow) seek(flow, sec);
				}}
				ondeleteformation={removeFormation}
				onmoveformation={moveFormationTo}
				selectedActionId={session.selectedActionId}
				onselectaction={(id) => {
					session.selectAction(id);
					inspectorTab = 'action';
				}}
				ask={session.ask}
				selectedMemberIds={session.selectedMemberIds}
				onselectmembers={selectMembers}
				multi={session.multiSelect}
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
	<div class="rotate-hint">
		<Icon name="fit" size={28} />
		<b>請把 iPad 轉成橫的</b>
		<span>編輯畫面要橫著放，場地和時間軸才放得下。</span>
	</div>
	{#if openSegmentId}
		<SegmentSettings
			{flow}
			segmentId={openSegmentId}
			{audios}
			{decode}
			onchange={change}
			onaudioload={(id, audio) => (audios[id] = audio)}
			onpreview={(id) => flow && preview(flow, id)}
			onclose={() => (openSegmentId = null)}
		/>
	{/if}
	{#if settingsOpen}
		<FlowSettings {flow} onchange={change} onclose={() => (settingsOpen = false)} />
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
					<p id="draft-offer-text">上次編的「{draftOffer.name}」還沒存，要救回嗎？</p>
					<div class="row">
						<button type="button" class="primary" onclick={() => draftOffer && restoreDraft(draftOffer.bytes)}
							>救回</button
						>
						<button type="button" onclick={discardDraft}>丟掉</button>
					</div>
				</div>
			{:else}
				<NewFlowForm oncreate={startFlow} />
				<div class="home-open">
					<span>已經有流程檔？</span>
					<label class="open btn"><Icon name="open" />開啟流程檔<input type="file" accept=".zip" onchange={open} /></label>
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	.toast {
		position: absolute;
		top: 14px;
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
	.toast button:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translate(-50%, -6px);
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

	/* 觸控螢幕拿直的（iPad 直放）：蓋住編輯畫面，請教練轉成橫的。 */
	.rotate-hint {
		display: none;
	}
	/* screen：列印八拍表時（紙是直的）不能印到它。 */
	@media screen and (pointer: coarse) and (orientation: portrait) {
		.rotate-hint {
			position: fixed;
			inset: 0;
			z-index: 100;
			display: grid;
			place-content: center;
			justify-items: center;
			gap: 10px;
			padding: 24px;
			text-align: center;
			background: var(--ink);
			color: #c9d2e6;
			font-size: 15px;
		}
		.rotate-hint b {
			color: #fff;
			font-size: 22px;
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
