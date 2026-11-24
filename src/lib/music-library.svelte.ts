// 音樂檔庫：這支流程用到的音樂檔。一支開著的流程一個，編輯器 module 握著（getEditor().music），換流程就換一個新的。
// 管：解碼過的音樂（含壞掉的）、還留著哪些（復原可能還要用，只加不刪）、存檔和草稿要寫的位元組、
// 每個音樂的長度和波形、哪幾段找不到音樂、給音訊引擎的 buffer。
// 給一段選音樂檔也在這裡：解碼、跟核心拿 id（核心的「選音樂」只有這裡在叫，還留著哪些由這裡報）。
// 雲端流程（upload 有接）選的音樂檔先傳上雲端（#249），傳好才送那一步；超過 60 MB 不傳。

import {
	fitSegmentToAudio,
	loadSegmentAudio,
	runCommand,
	segmentsMissingAudio,
	type AudioBytes,
	type AudioLengths,
	type Command,
	type Flow
} from '#lib/core';
import type { DecodedAudio, LoadedAudio } from '#lib/audio/decode.js';
import { newStepId, type Ask } from '#lib/ask.svelte.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { m } from '#lib/paraglide/messages.js';

/** 雲端流程一個音樂檔最大幾個位元組（60 MB）。伺服器 server/src/music.rs 的 MAX_AUDIO_BYTES 跟它一樣。 */
export const MAX_CLOUD_AUDIO_BYTES = 60 * 1024 * 1024;

/** 把音樂檔傳上雲端（audioId：流程裡這個音樂檔的 id）。伺服器查到太大是 'tooBig'；連不上丟錯。 */
export type UploadAudio = (audioId: string, file: File) => Promise<'ok' | 'tooBig'>;

export class MusicLibrary {
	/** 雲端流程：選的音樂檔先傳上雲端（流程檔打開雲端流程時接上）；本機流程是 null。 */
	upload: UploadAudio | null = null;
	readonly #session: EditorSession;
	readonly #decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
	/** 解碼過的音樂檔，用 flow.audio 的 id 對應；位元組不放進流程。 */
	#audios = $state.raw<Record<string, LoadedAudio>>({});
	/** 還在解碼的音樂檔（回上次那支先畫場地、音樂之後才好，#379）：位元組先留著，存檔、草稿照樣寫進去。 */
	#decoding = $state.raw<Record<string, ArrayBuffer>>({});
	/** 還在解碼、解完還要的選檔（每次選一個記號）；段設定關了、換了流程就清掉，解完就丟掉結果。 */
	#picks = new Set<object>();

	/** 有指到音樂檔、但手上沒有那個檔的音樂段（時間軸標紅「找不到音樂」）。 */
	readonly missingSegmentIds: string[];

	constructor(session: EditorSession, decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>) {
		this.#session = session;
		this.#decode = decode;
		this.missingSegmentIds = $derived(session.flow ? segmentsMissingAudio(session.flow, this.#heldIds) : []);
	}

	/**
	 * 開檔、救回草稿：檔案裡的音樂解碼好放進來（編輯器 module 的 readMusic 用）。
	 * 一叫就先收下位元組（loading，解完才有長度、波形、聲音）：不等它解完也能換上（回上次那支，#379）。
	 */
	async load(audio: AudioBytes): Promise<void> {
		const decoding = Object.fromEntries(Object.entries(audio).map(([id, bytes]) => [id, bytes.slice().buffer]));
		this.#decoding = { ...this.#decoding, ...decoding };
		const loaded: Record<string, LoadedAudio> = {};
		for (const [id, buffer] of Object.entries(decoding)) {
			try {
				loaded[id] = { bytes: buffer, ...(await this.#decode(buffer)) };
			} catch {
				// 這個瀏覽器解不開（例：Firefox 沒有 AAC）：位元組留著，存檔時照樣存回去，只是不出聲。
				loaded[id] = { bytes: buffer, durationSec: 0, peaks: [], broken: true };
			}
		}
		this.#audios = { ...this.#audios, ...loaded };
		this.#decoding = Object.fromEntries(Object.entries(this.#decoding).filter(([id]) => !(id in loaded)));
	}

	/** 還有音樂在解碼（還不知道多長、還不能播）。 */
	get loading(): boolean {
		return Object.keys(this.#decoding).length > 0;
	}

	/** 這個音樂檔還在解碼（時間軸、段設定寫「載入中」）。 */
	loadingAudio(audioId: string | null | undefined): boolean {
		return !!audioId && audioId in this.#decoding;
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
		for (const a of flow.audio) {
			const bytes = this.#audios[a.id]?.bytes ?? this.#decoding[a.id];
			if (bytes) audio[a.id] = new Uint8Array(bytes);
		}
		return audio;
	}

	/** 這個音樂檔（沒有 id、手上沒有這個檔是 undefined）：長度、波形；壞的標 broken。 */
	get(audioId: string | null | undefined): LoadedAudio | undefined {
		return audioId ? this.#audios[audioId] : undefined;
	}

	/**
	 * 給一段選一個音樂檔：解碼，跟核心拿新的 id，結果交給 ask（段設定的「改」：成功就算一步）。
	 * 被擋的原因（格式不對、讀不出來）也交給 ask。解完之前叫了 cancelPicks（段設定關了、換了流程）就丟掉。
	 * 這一段第一次有音樂：長度順便照音樂長度算（同一步；會刪到東西、算不出來就只載入）。
	 * 雲端流程：超過 60 MB 直接擋；解碼好先傳上雲端，傳好才送那一步（太大、連不上就擋下，流程不改）。
	 */
	async pick(segmentId: string, file: File, ask: Ask): Promise<void> {
		const check = loadSegmentAudio(this.#flow, segmentId, file.name, this.#heldIds);
		if (check.kind === 'blocked') return void ask.block(check);
		const upload = this.upload;
		if (upload && file.size > MAX_CLOUD_AUDIO_BYTES) return void ask.block(m.file_audio_too_big());
		const pick = {};
		this.#picks.add(pick);
		const bytes = await file.arrayBuffer();
		let decoded: DecodedAudio;
		try {
			decoded = await this.#decode(bytes);
		} catch {
			if (this.#picks.delete(pick)) ask.block(m.file_audio_unreadable());
			return;
		}
		// 解碼時段設定已經關掉（可能換開了別段、別的流程）：這個檔不要了。
		if (!this.#picks.has(pick)) return;
		// 還留著哪些先記下來：音樂放進來之後再算，核心會給另一個 id。
		const held = this.#heldIds;
		const load: Command<'loadSegmentAudio'> = { name: 'loadSegmentAudio', args: [segmentId, file.name, held] };
		// 步驟 id 先發好：音樂檔的 id 由它算出來（ADR 0014），音樂檔庫、雲端都用這個 id 記。
		const stepId = newStepId();
		if (upload) {
			const r = runCommand(this.#flow, load, stepId);
			if (r.kind === 'ok') {
				let sent: 'ok' | 'tooBig' | 'unreachable';
				try {
					sent = await upload(r.audioId, file);
				} catch {
					sent = 'unreachable';
				}
				if (!this.#picks.has(pick)) return;
				if (sent !== 'ok') {
					this.#picks.delete(pick);
					return void ask.block(sent === 'tooBig' ? m.file_audio_too_big() : m.file_audio_upload_failed());
				}
			}
		}
		this.#picks.delete(pick);
		// 解碼、傳上去要一點時間，用那時候的流程再送一次指令（同一個步驟 id，音樂檔的 id 一樣）。
		// 音樂先放進來再換流程：流程換了時這段已經有音樂（流程檔看要不要收掉「找不到音樂」的提示）。
		const first = this.#flow.segments.some((s) => s.id === segmentId && s.kind === 'music' && s.audioId === null);
		const r = runCommand(this.#flow, load, stepId);
		if (r.kind !== 'ok') return void ask.send(load, { stepId });
		this.#audios = { ...this.#audios, [r.audioId]: { bytes, ...decoded } };
		const lengths = { [r.audioId]: decoded.durationSec };
		const fit = first ? fitSegmentToAudio(r.flow, segmentId, lengths) : null;
		if (fit?.kind === 'ok') ask.send([load, { name: 'fitSegmentToAudio', args: [segmentId, lengths] }], { stepId });
		else ask.send(load, { stepId });
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
		return [...Object.keys(this.#audios), ...Object.keys(this.#decoding)];
	}
}
