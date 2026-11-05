// 播放：播放頭（全域秒數）、在不在播、節拍器、延遲校正、試聽。編輯器 module 握著（getEditor().playback），一個編輯頁一個。
// 播放器（#lib/audio/player.js：排程和時鐘換算）是它的內部；音訊引擎第一次播放時才建。
// 畫面時鐘（nextFrame）是 adapter：瀏覽器用 requestAnimationFrame，測試手動撥一格。

import { firstBeatPreview, playbackPlan, playStartSec, resumeSec, stepPlayhead, totalSeconds, type Flow } from '#lib/core';
import type { AudioEngine } from '#lib/audio/engine.js';
import { createPlayer, type Player } from '#lib/audio/player.js';
import type { SessionPlayback } from '#lib/editor-session.svelte.js';
import { loadLatencyMs, MAX_LATENCY_MS, saveLatencyMs } from '#lib/local-settings.js';

/** 畫面時鐘：下一格畫面時叫 run 一次。 */
export type NextFrame = (run: () => void) => void;

/** 真的畫面時鐘：requestAnimationFrame。 */
export const animationFrame: NextFrame = (run) => void requestAnimationFrame(() => run());

export class Playback implements SessionPlayback {
	readonly #flow: () => Flow | null;
	readonly #createEngine: () => AudioEngine;
	readonly #nextFrame: NextFrame;
	#player: Player | null = null;

	#sec = $state(0);
	#playing = $state(false);
	#metronome = $state(true);
	/** 段設定的「從第一拍聽」正在響：按鈕換成停止，關掉段設定就停。 */
	#previewing = $state(false);
	/** 延遲校正（毫秒）：存在這台電腦，不進流程檔。 */
	#latencyMs = $state(loadLatencyMs());

	/** flow：現在的流程；createEngine：建音訊引擎（第一次播放時才建）。 */
	constructor(flow: () => Flow | null, createEngine: () => AudioEngine, nextFrame: NextFrame) {
		this.#flow = flow;
		this.#createEngine = createEngine;
		this.#nextFrame = nextFrame;
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

	get latencyMs(): number {
		return this.#latencyMs;
	}

	#getPlayer(): Player {
		this.#player ??= createPlayer(this.#createEngine());
		return this.#player;
	}

	/** 從播放頭開始播；已經播完就從頭。沒有段時沒東西可以播。一定由按鈕或空白鍵觸發。 */
	play() {
		const f = this.#flow();
		if (!f?.segments.length) return;
		this.#sec = playStartSec(f, this.#sec);
		this.#getPlayer().start(playbackPlan(f, this.#sec), { fromSec: this.#sec, metronome: this.#metronome });
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

	/** 播放鍵：播放中就暫停，不然播放。 */
	toggle() {
		if (this.#playing) this.pause();
		else this.play();
	}

	/**
	 * 空白鍵：跟播放鍵一樣。dialogOpen：對話框開著時只能暫停（不在對話框後面開始播）。
	 * 回傳有沒有用到這個鍵（沒用到就照瀏覽器原本的）。
	 */
	space(dialogOpen: boolean): boolean {
		if (dialogOpen && !this.#playing) return false;
		this.toggle();
		return true;
	}

	/** 跳到某一秒（夾在 0 到流程結尾之間）；播放中就從那裡重新排聲音。 */
	seek(sec: number) {
		const f = this.#flow();
		if (!f) return;
		this.#sec = Math.min(Math.max(sec, 0), totalSeconds(f));
		if (this.#playing) this.play();
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
		if (this.#playing) this.play();
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

	/** 換一支流程（開檔、新建、救回草稿、回首頁）：播放、試聽停下，播放頭回到開頭。 */
	opened() {
		this.pause();
		this.#sec = 0;
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
	 * 只看 segments 這個陣列換了沒：改人、改動作不重排（不能看整個流程換了沒，62f3f55）。
	 */
	changed(before: Flow) {
		const f = this.#flow();
		if (!f || f.segments === before.segments) return;
		const { sec, ended } = resumeSec(f, this.#sec);
		this.#sec = sec;
		if (!this.#playing) return;
		if (ended) this.pause();
		else this.play();
	}

	/** 每一格畫面：照喇叭正在播的時間移動播放頭；播完就停。 */
	#frame = () => {
		if (!this.#playing || !this.#player) return;
		this.#sec = this.#player.tick(this.#latencyMs);
		if (!this.#player.playing) this.#playing = false;
		else this.#nextFrame(this.#frame);
	};

	/** 試聽播完了沒（播放頭不動，只看播完）。 */
	#previewFrame = () => {
		if (!this.#previewing || !this.#player) return;
		this.#player.tick(0);
		if (!this.#player.playing) this.#previewing = false;
		else this.#nextFrame(this.#previewFrame);
	};
}
