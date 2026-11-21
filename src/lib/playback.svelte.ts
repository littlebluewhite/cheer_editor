// 播放：播放頭（全域秒數）、在不在播、節拍器、延遲校正、試聽。編輯器 module 握著（getEditor().playback），一個編輯頁一個。
// 播放器（#lib/audio/player.js：排程和時鐘換算）是它的內部；音訊引擎第一次播放時才建。
// 畫面時鐘（nextFrame）是 adapter：瀏覽器用 requestAnimationFrame，測試手動撥一格。

import {
	actionRange,
	bookmarkOfRange,
	bookmarkSeconds,
	firstBeatPreview,
	playbackPlan,
	playStartSec,
	rangeEnd,
	rangeSeconds,
	resumeSec,
	samePosition,
	snapToBeat,
	startAt,
	stepPlayhead,
	totalSeconds,
	type Action,
	type Bookmark,
	type Flow,
	type RepeatRange,
	type TimePosition
} from '#lib/core';
import type { AudioEngine } from '#lib/audio/engine.js';
import { createPlayer, type Lap, type Player } from '#lib/audio/player.js';
import type { SessionPlayback } from '#lib/editor-session.svelte.js';
import {
	loadLatencyMs,
	loadReturnOnStop,
	MAX_LATENCY_MS,
	saveLatencyMs,
	saveReturnOnStop
} from '#lib/local-settings.js';

/** 播放速度可以選的：正常、0.75x、0.5x（慢速時音高不變）。 */
export const SPEEDS = [1, 0.75, 0.5] as const;

/** 畫面時鐘：下一格畫面時叫 run 一次。 */
export type NextFrame = (run: () => void) => void;

/** 真的畫面時鐘：requestAnimationFrame。 */
export const animationFrame: NextFrame = (run) => void requestAnimationFrame(() => run());

export class Playback implements SessionPlayback {
	readonly #flow: () => Flow | null;
	readonly #createEngine: () => AudioEngine;
	readonly #nextFrame: NextFrame;
	readonly #moved: () => void;
	readonly #selectedAction: () => Action | null;
	#player: Player | null = null;

	#at = $state(0);
	#playing = $state(false);
	#metronome = $state(true);
	/** 播放速度：1、0.75、0.5（音高不變）。不進流程檔。 */
	#rate = $state(1);
	/** 重複：開著就一直播重複範圍。要有完整的重複範圍才開得了。不進流程檔。 */
	#repeat = $state(false);
	/** 重複範圍（A 到 B）；只放了 A 時 b 是 null。不進流程檔，換流程就拿掉。 */
	#range = $state<RepeatRange | null>(null);
	/** 段設定的「從第一拍聽」正在響：按鈕換成停止，關掉段設定就停。 */
	#previewing = $state(false);
	/** 延遲校正（毫秒）：存在這台電腦，不進流程檔。 */
	#latencyMs = $state(loadLatencyMs());
	/** 起播點：這次從哪一秒開始播（播放中點八拍尺跳過去也算）。停下來回到這裡。 */
	#startSec = $state(0);
	/** 停下來回到起播點：存在這台電腦，預設開著。 */
	#returnOnStop = $state(loadReturnOnStop());

	/**
	 * flow：現在的流程；createEngine：建音訊引擎（第一次播放時才建）。
	 * moved：播放頭動了要叫的（編輯器 module 接上：動作表單的草稿跟著播放頭）。
	 * selectedAction：選著的動作（沒有重複範圍時按「重複」，範圍拉成它）。
	 */
	constructor(
		flow: () => Flow | null,
		createEngine: () => AudioEngine,
		nextFrame: NextFrame,
		moved: () => void,
		selectedAction: () => Action | null
	) {
		this.#flow = flow;
		this.#createEngine = createEngine;
		this.#nextFrame = nextFrame;
		this.#moved = moved;
		this.#selectedAction = selectedAction;
	}

	/** 播放頭（全域秒數）；每次改都叫 moved。 */
	get #sec(): number {
		return this.#at;
	}

	set #sec(sec: number) {
		this.#at = sec;
		this.#moved();
	}

	/** 播放頭，全域秒數。 */
	get sec(): number {
		return this.#sec;
	}

	get playing(): boolean {
		return this.#playing;
	}

	get previewing(): boolean {
		return this.#previewing;
	}

	get metronome(): boolean {
		return this.#metronome;
	}

	get rate(): number {
		return this.#rate;
	}

	get repeat(): boolean {
		return this.#repeat;
	}

	get latencyMs(): number {
		return this.#latencyMs;
	}

	/** 重複範圍現在在哪（全域秒數）；只放了 A 時 b 是 null。 */
	get range(): { a: number; b: number | null } | null {
		const f = this.#flow();
		return f && this.#range && rangeSeconds(f, this.#range);
	}

	/** 重複範圍兩頭在哪（哪一段的第幾格），照原樣、不吸整拍；書籤存的就是這個。沒有範圍是 null。 */
	get rangeAt(): RepeatRange | null {
		return this.#range;
	}

	/** 「重複」按得下去：有完整的重複範圍，或選著動作（範圍拉成它）。 */
	get canRepeat(): boolean {
		return this.range?.b != null || this.#selectedAction() !== null;
	}

	/** 起播點（全域秒數）；沒在播是 null。 */
	get startSec(): number | null {
		return this.#playing ? this.#startSec : null;
	}

	get returnOnStop(): boolean {
		return this.#returnOnStop;
	}

	#getPlayer(): Player {
		this.#player ??= createPlayer(this.#createEngine());
		return this.#player;
	}

	/**
	 * 從播放頭開始播；已經播完就從頭。沒有段時沒東西可以播。一定由按鈕或空白鍵觸發。
	 * 重複開著：只播到 B，接著從 A 一直重複（下一圈先排好，圈和圈之間不停）；播放頭不在範圍裡就從 A 開始。
	 */
	play() {
		this.#run();
		this.#startSec = this.#at;
	}

	/** 照現在的設定從播放頭排聲音（開始播，或播放中改了節拍器、速度、流程時重排）；起播點不動。 */
	#run() {
		const f = this.#flow();
		if (!f?.segments.length) return;
		this.#sec = playStartSec(f, this.#sec);
		const span = this.#activeRange();
		// 重複開著只在範圍裡播：播放頭、起播點在外面就是 A
		if (span && outside(span, this.#sec)) this.#sec = span.a;
		if (span && outside(span, this.#startSec)) this.#startSec = span.a;
		this.#getPlayer().start(playbackPlan(f, this.#sec, span?.b), {
			fromSec: this.#sec,
			metronome: this.#metronome,
			rate: this.#rate,
			loop: span ? this.#nextLap : undefined
		});
		if (!this.#playing) {
			this.#playing = true;
			this.#nextFrame(this.#frame);
		}
	}

	pause() {
		this.#playing = false;
		this.#previewing = false;
		this.#player?.stop();
	}

	/** 播放中開始拖人：先暫停，播放頭停到最近的整拍（站位才不會插在半拍上）。沒在播就不動。 */
	pauseOnBeat() {
		const f = this.#flow();
		if (!this.#playing || !f) return;
		this.pause();
		this.#sec = snapToBeat(f, this.#sec);
	}

	/**
	 * 播放鍵：播放中就停下，不然播放。停下時照「停下來回到起播點」的開關回去或留在原地；
	 * flip（Shift＋空白鍵）：做跟開關相反的事。
	 */
	toggle(flip = false) {
		if (!this.#playing) return this.play();
		this.pause();
		if (this.#returnOnStop !== flip) this.#backToStart();
	}

	/**
	 * 空白鍵：跟播放鍵一樣（flip：按著 Shift）。dialogOpen：對話框開著時只能停（不在對話框後面開始播）。
	 * 回傳有沒有用到這個鍵（沒用到就照瀏覽器原本的）。
	 */
	space(dialogOpen: boolean, flip = false): boolean {
		if (dialogOpen && !this.#playing) return false;
		this.toggle(flip);
		return true;
	}

	/** 開關「停下來回到起播點」；存在這台電腦。 */
	setReturnOnStop(on: boolean) {
		this.#returnOnStop = on;
		saveReturnOnStop(on);
	}

	/** 播放頭回到起播點（段變短了就夾回流程裡）。 */
	#backToStart() {
		const f = this.#flow();
		if (f) this.#sec = resumeSec(f, this.#startSec).sec;
	}

	/**
	 * 跳到某一秒（夾在 0 到流程結尾之間）；播放中就從那裡重新排聲音（起播點跟著過去），
	 * 跳到結尾就是播完了，停下（不從頭重播，也不回起播點）。
	 * 重複開著時只在範圍裡播：播放中跳到範圍外面（包括結尾）就跳回 A；停著時可以跳出去看，按播放還是從 A 播。
	 */
	seek(sec: number) {
		const f = this.#flow();
		if (!f) return;
		const { sec: at, ended } = resumeSec(f, sec);
		this.#sec = at;
		if (!this.#playing) return;
		if (ended && !this.#activeRange()) this.pause();
		else this.play();
	}

	/** 跳到流程開頭（Home）。 */
	toStart() {
		this.seek(0);
	}

	/** 跳到流程結尾（End）。 */
	toEnd() {
		const f = this.#flow();
		if (f) this.seek(totalSeconds(f));
	}

	/** 往前或往後一拍（eight：一個八拍，跳到八拍的 1）。 */
	step(dir: 1 | -1, eight: boolean) {
		const f = this.#flow();
		if (f) this.seek(stepPlayhead(f, this.#sec, dir, eight));
	}

	/** 段設定的「▶ 從第一拍聽 2 個八拍」：先停掉正在播的流程；播放頭不動，播完自己停。 */
	preview(segmentId: string) {
		const f = this.#flow();
		if (!f) return;
		this.pause();
		this.#getPlayer().start(firstBeatPreview(f, segmentId), { fromSec: 0, metronome: true });
		this.#previewing = true;
		this.#nextFrame(this.#previewFrame);
	}

	stopPreview() {
		if (!this.#previewing) return;
		this.#previewing = false;
		this.#player?.stop();
	}

	/** 開關節拍器；播放中就照新的設定重排。 */
	setMetronome(on: boolean) {
		this.#metronome = on;
		if (this.#playing) this.#run();
	}

	/**
	 * 開關重複；播放中就照新的設定重排。沒有重複範圍時：選著動作就把範圍拉成那個動作，沒選就開不了。
	 * 已經有範圍就只是開關，不換掉範圍。
	 */
	setRepeat(on: boolean) {
		const f = this.#flow();
		const action = this.#selectedAction();
		if (on && this.range?.b == null) {
			if (!f || !action) return;
			this.#range = actionRange(action);
		}
		this.#setRepeatOn(on);
	}

	/** A：重複範圍從播放頭最近的整拍開始（流程結尾不行，後面放不了 B）。原本的 B 不在它後面就拿掉（重複也關掉），再放一次 B。 */
	setA() {
		const f = this.#flow();
		if (!f || !this.canSetA) return;
		const a = rangeEnd(f, this.#sec);
		const range = this.#range && rangeSeconds(f, { a, b: this.#range.b });
		this.#range = { a, b: range ? this.#range!.b : null };
		// 範圍變了才重排（重複關著時聲音不受影響，不用重排）
		if (!range) {
			if (this.#repeat) this.#setRepeatOn(false);
		} else if (this.#repeat && this.#playing) this.#run();
	}

	/** B：重複範圍到播放頭最近的整拍為止，重複自己打開；播放中就馬上跳回 A 開始重複。要先有 A，B 要在 A 後面；不然不動。 */
	setB() {
		const f = this.#flow();
		if (!f || !this.#range) return;
		if (!this.#setRange(f, { a: this.#range.a, b: rangeEnd(f, this.#sec) })) return;
		if (this.#playing) this.seek(this.range!.a);
	}

	/** A 按得下去：有段，播放頭最近的整拍不是流程結尾。 */
	get canSetA(): boolean {
		const f = this.#flow();
		return !!f?.segments.length && snapToBeat(f, this.#sec) < totalSeconds(f) - 1e-6;
	}

	/** B 按得下去：有 A，播放頭最近的整拍在 A 後面。 */
	get canSetB(): boolean {
		const f = this.#flow();
		return !!f && !!this.#range && !!rangeSeconds(f, { a: this.#range.a, b: rangeEnd(f, this.#sec) });
	}

	/** 在八拍尺上拉出重複範圍（兩頭吸到整拍，可以倒著拉），重複自己打開。不到一格（一拍、口號段 0.1 秒）就不動。 */
	setRange(fromSec: number, toSec: number) {
		const f = this.#flow();
		if (!f?.segments.length) return;
		this.#setRange(f, { a: rangeEnd(f, Math.min(fromSec, toSec)), b: rangeEnd(f, Math.max(fromSec, toSec)) });
	}

	/** 重複範圍換成這兩頭（照原樣，不吸整拍；書籤用），重複打開。放不下（B 不在 A 後面）就不動。 */
	useRange(range: RepeatRange) {
		const f = this.#flow();
		if (f) this.#setRange(f, range);
	}

	// ---------- 書籤叫的 ----------

	/**
	 * 用這個書籤：有 B 的把重複範圍換成 A 到 B（照書籤原樣，不吸整拍）、打開重複；
	 * 只有 A 的、A 在重複範圍外：關掉重複（範圍留著），不然重複開著會被拉回範圍的 A。最後播放頭跳到 A。
	 * 書籤放不下（段不見了）就不動。
	 */
	useBookmark(bm: Pick<Bookmark, 'a' | 'b'>) {
		const f = this.#flow();
		const s = f && bookmarkSeconds(f, bm);
		if (!s) return;
		if (bm.b) this.useRange({ a: bm.a, b: bm.b });
		else if (this.#repeat) {
			const span = this.#activeRange();
			if (!span || outside(span, s.a)) this.#setRepeatOn(false);
		}
		this.seek(s.a);
	}

	/** 正在播的書籤（重複開著，範圍跟它在同一個地方）的 id；沒有是 null。只有 A 的書籤不算。 */
	get playingBookmark(): string | null {
		const f = this.#flow();
		if (!f || !this.#repeat || !this.#range) return null;
		return bookmarkOfRange(f, this.#range)?.id ?? null;
	}

	/**
	 * 存成書籤時要存的 A、B：有重複範圍（不管重複開不開、有沒有 B）就照它原樣（半拍開始的動作拉成的範圍不吸到整拍）；
	 * 沒有就是播放頭最近的整拍、只有 A。沒有段是 null。
	 */
	get bookmarkSpot(): { a: TimePosition; b: TimePosition | null } | null {
		const f = this.#flow();
		if (!f?.segments.length) return null;
		if (this.#range) return { a: this.#range.a, b: this.#range.b };
		return { a: startAt(f, this.#sec), b: null };
	}

	/**
	 * 開始拖重複範圍的一頭（end）：回傳拖的時候每動一下叫的函式。另一頭照按下去時存的位置不動（不重新吸整拍），
	 * 拖過另一頭就對調。還沒有完整的範圍時不動。
	 */
	dragRangeEnd(end: 'a' | 'b'): (sec: number) => void {
		const fixed = end === 'a' ? this.#range?.b : this.#range?.a;
		return (sec) => {
			const f = this.#flow();
			if (!f?.segments.length || !fixed) return;
			const moved = rangeEnd(f, sec);
			if (!this.#setRange(f, { a: fixed, b: moved })) this.#setRange(f, { a: moved, b: fixed });
		};
	}

	/** 換成這個範圍、打開重複；不到一格就不動，回傳 false。 */
	#setRange(f: Flow, range: RepeatRange): boolean {
		if (!rangeSeconds(f, range)?.b) return false;
		// 拖的時候每動一下都會叫；吸到的整拍沒變就不重排聲音
		if (this.#repeat && samePosition(this.#range?.a, range.a) && samePosition(this.#range?.b, range.b)) return true;
		this.#range = range;
		this.#setRepeatOn(true);
		return true;
	}

	/** ✕：拿掉重複範圍，重複也關掉（播放中就接著往下播）。 */
	clearRange() {
		this.#range = null;
		this.#setRepeatOn(false);
	}

	#setRepeatOn(on: boolean) {
		this.#repeat = on;
		if (this.#playing) this.#run();
	}

	/** 正在重複的範圍（全域秒數）；重複關著、範圍不完整是 null。 */
	#activeRange(): { a: number; b: number } | null {
		const range = this.#repeat ? this.range : null;
		return range?.b == null ? null : { a: range.a, b: range.b };
	}

	/** 換播放速度；播放中就照新的速度重排。 */
	setRate(rate: number) {
		this.#rate = rate;
		if (this.#playing) this.#run();
	}

	/**
	 * 延遲校正（毫秒）：只移畫面上的播放頭，不動聲音；存在這台電腦。
	 * 不是數字（清空、亂填）或超出範圍就不改，回傳 false（欄位要回到現在的值，不然欄位空著，實際還在用舊值）。
	 */
	setLatency(ms: number): boolean {
		if (!(Math.abs(ms) <= MAX_LATENCY_MS)) return false;
		this.#latencyMs = ms;
		saveLatencyMs(ms);
		return true;
	}

	// ---------- session 叫的 ----------

	/** 換一支流程（開檔、新建、救回草稿、回首頁）：播放、試聽停下，播放頭回到開頭，重複範圍拿掉（段的 id 會跟上一支重複）。 */
	opened() {
		this.pause();
		this.#sec = 0;
		this.#range = null;
		this.#repeat = false;
	}

	/**
	 * 改完要跳播放頭。拖人插站位（replay = false）：直接停到那張，播放中照樣跟著音樂走；
	 * 挪站位（true）：跟點八拍尺一樣，播放中從那裡重播。
	 */
	jump(sec: number, replay: boolean) {
		if (replay) this.seek(sec);
		else this.#sec = sec;
	}

	/**
	 * 換上改過、復原、重做的流程：段換了（換順序、刪段、改 BPM、長度）就把播放頭夾回流程裡（不回到 0），
	 * 播放中就從夾住的地方照現在的段重排；夾到結尾就是播完了，停下。
	 * 重複範圍跟著音樂走；它所在的段不見了（或換了順序、B 跑到 A 前面）就拿掉，重複也關掉。
	 * 只看 segments 這個陣列換了沒：改人、改動作不重排（不能看整個流程換了沒，62f3f55）。
	 */
	changed(before: Flow) {
		const f = this.#flow();
		if (!f || f.segments === before.segments) return;
		if (this.#range && !rangeSeconds(f, this.#range)) {
			this.#range = null;
			this.#repeat = false;
		}
		const { sec, ended } = resumeSec(f, this.#sec);
		this.#sec = sec;
		if (!this.#playing) return;
		if (ended) this.pause();
		else this.#run();
	}

	/** 重複的下一圈：照現在的流程和重複範圍。重複關掉了、範圍不能用了就不再重複。 */
	#nextLap = (): Lap | null => {
		const f = this.#flow();
		const span = this.#activeRange();
		if (!f || !span) return null;
		return { plan: playbackPlan(f, span.a, span.b), fromSec: span.a };
	};

	/**
	 * 每一格畫面：照喇叭正在播的時間移動播放頭；播完就停，開著「停下來回到起播點」就回去
	 * （重複開著時播放器自己一圈接一圈播，不會停）。
	 */
	#frame = () => {
		if (!this.#playing || !this.#player) return;
		this.#sec = this.#player.tick(this.#latencyMs);
		if (this.#player.playing) return this.#nextFrame(this.#frame);
		this.#playing = false;
		if (this.#returnOnStop) this.#backToStart();
	};

	/** 試聽播完了沒（播放頭不動，只看播完）。 */
	#previewFrame = () => {
		if (!this.#previewing || !this.#player) return;
		this.#player.tick(0);
		if (!this.#player.playing) this.#previewing = false;
		else this.#nextFrame(this.#previewFrame);
	};
}

/** sec 在不在重複範圍外面（剛好在 B 也算外面：從 B 播沒東西可以播）。 */
function outside(span: { a: number; b: number }, sec: number): boolean {
	return sec < span.a - 1e-6 || sec >= span.b - 0.01;
}
