// 音樂檔庫：這支流程用到的音樂檔。一支開著的流程一個，編輯器 module 握著（getEditor().music），換流程就換一個新的。
// 管：解碼過的音樂（含壞掉的）、還留著哪些（復原可能還要用，只加不刪）、存檔和草稿要寫的位元組、
// 每個音樂的長度和波形、哪幾段找不到音樂、給音訊引擎的 buffer。
// 給一段選音樂檔也在這裡：解碼、跟核心拿 id（核心的「選音樂」只有這裡在叫，還留著哪些由這裡報）。

import { loadSegmentAudio, segmentsMissingAudio, type AudioBytes, type AudioLengths, type Flow } from '#lib/core';
import type { DecodedAudio, LoadedAudio } from '#lib/audio/decode.js';
import type { Ask } from '#lib/ask.svelte.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';

export class MusicLibrary {
	readonly #session: EditorSession;
	readonly #decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
	readonly #onpicked: () => void;
	/** 解碼過的音樂檔，用 flow.audio 的 id 對應；位元組不放進流程。 */
	#audios = $state.raw<Record<string, LoadedAudio>>({});
	/** 還在解碼、解完還要的選檔（每次選一個記號）；段設定關了、換了流程就清掉，解完就丟掉結果。 */
	#picks = new Set<object>();

	/** 有指到音樂檔、但手上沒有那個檔的音樂段（時間軸標紅「找不到音樂」）。 */
	readonly missingSegmentIds: string[];

	/** onpicked：給一段選好了音樂檔、放進來之後（流程檔收掉「找不到音樂」的提示）。 */
	constructor(session: EditorSession, decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>, onpicked = () => {}) {
		this.#session = session;
		this.#decode = decode;
		this.#onpicked = onpicked;
		this.missingSegmentIds = $derived(session.flow ? segmentsMissingAudio(session.flow, Object.keys(this.#audios)) : []);
	}

	/** 開檔、救回草稿：檔案裡的音樂解碼好放進來（編輯器 module 的 readMusic 用）。 */
	async load(audio: AudioBytes): Promise<void> {
		const loaded: Record<string, LoadedAudio> = {};
		for (const [id, bytes] of Object.entries(audio)) {
			const buffer = bytes.slice().buffer;
			try {
				loaded[id] = { bytes: buffer, ...(await this.#decode(buffer)) };
			} catch {
				// 這個瀏覽器解不開（例：Firefox 沒有 AAC）：位元組留著，存檔時照樣存回去，只是不出聲。
				loaded[id] = { bytes: buffer, durationSec: 0, peaks: [], broken: true };
			}
		}
		this.#audios = { ...this.#audios, ...loaded };
	}

	/** 有這個瀏覽器解不開的音樂檔（開檔後提示播放時會沒有聲音）。 */
	get hasBroken(): boolean {
		return Object.values(this.#audios).some((a) => a.broken);
	}

	/** 每個音樂多長（秒），給核心擋「第一拍要在音樂結束之前」、算「照音樂長度算」；壞的是 null（不知道多長）。 */
	readonly lengths: AudioLengths = $derived(
		Object.fromEntries(Object.entries(this.#audios).map(([id, a]) => [id, a.broken ? null : a.durationSec]))
	);

	/** 給音訊引擎播放用的音樂（測試的假解碼沒有，那一段就不出聲）。 */
	buffer(audioId: string): AudioBuffer | undefined {
		return this.#audios[audioId]?.buffer;
	}

	/** 存檔、草稿要寫的音樂位元組：這支流程用到、手上有的（壞的也照樣存回去）。 */
	bytes(flow: Flow): AudioBytes {
		const audio: AudioBytes = {};
		for (const a of flow.audio) if (this.#audios[a.id]) audio[a.id] = new Uint8Array(this.#audios[a.id].bytes);
		return audio;
	}

	/** 這個音樂檔（沒有 id、手上沒有這個檔是 undefined）：長度、波形；壞的標 broken。 */
	get(audioId: string | null | undefined): LoadedAudio | undefined {
		return audioId ? this.#audios[audioId] : undefined;
	}

	/**
	 * 給一段選一個音樂檔：解碼，跟核心拿新的 id，結果交給 ask（段設定的「改」：成功就算一步）。
	 * 被擋的原因（格式不對、讀不出來）也交給 ask。解完之前叫了 cancelPicks（段設定關了、換了流程）就丟掉。
	 */
	async pick(segmentId: string, file: File, ask: Ask): Promise<void> {
		const check = loadSegmentAudio(this.#flow, segmentId, file.name, this.#heldIds);
		if (check.kind === 'blocked') return void ask.send(() => check);
		const pick = {};
		this.#picks.add(pick);
		const bytes = await file.arrayBuffer();
		let decoded: DecodedAudio;
		try {
			decoded = await this.#decode(bytes);
		} catch {
			if (this.#picks.delete(pick)) ask.send(() => ({ kind: 'blocked', message: '這個音樂檔讀不出來' }) as const);
			return;
		}
		// 解碼時段設定已經關掉（可能換開了別段、別的流程）：這個檔不要了。
		if (!this.#picks.delete(pick)) return;
		// 解碼要一點時間，用那時候的流程再送一次指令。
		ask.send(() => loadSegmentAudio(this.#flow, segmentId, file.name, this.#heldIds), {
			done: (r) => {
				this.#audios = { ...this.#audios, [r.audioId]: { bytes, ...decoded } };
				this.#onpicked();
			}
		});
	}

	/** 還在解碼的選檔都不要了：段設定關了、換了流程。 */
	cancelPicks() {
		this.#picks.clear();
	}

	/** 選音樂檔只在開著流程時（段設定）。 */
	get #flow(): Flow {
		return this.#session.flow!;
	}

	/** 還留著的音樂（流程不用了、復原還會用到）：核心不拿它們的 id 給新的檔。 */
	get #heldIds(): string[] {
		return Object.keys(this.#audios);
	}
}
