// 音訊薄層：把音樂檔解碼，拿到長度和前 20 秒的波形。播放在 #19 做。
// jsdom 沒有 Web Audio，所以元件把 decode 收成 prop，測試換成假的。

/** 段設定的波形只畫音樂檔的前幾秒。 */
export const WAVE_WINDOW_SEC = 20;
/** 波形切成幾欄，每欄取最大振幅。 */
const WAVE_COLUMNS = 600;

export interface DecodedAudio {
	durationSec: number;
	/** 前 WAVE_WINDOW_SEC 秒切成等寬的欄，每欄的最大振幅（0–1）。 */
	peaks: number[];
}

/** 畫面留著的一個音樂檔：原始位元組（存檔用）＋解碼結果。用流程裡的 audioId 對應。 */
export interface LoadedAudio extends DecodedAudio {
	bytes: ArrayBuffer;
}

let context: AudioContext | null = null;

export async function decodeAudio(bytes: ArrayBuffer): Promise<DecodedAudio> {
	context ??= new AudioContext();
	// decodeAudioData 會把傳進去的 ArrayBuffer 拿走，所以給一份複本，原本的留著存檔。
	const buffer = await context.decodeAudioData(bytes.slice(0));
	const data = buffer.getChannelData(0);
	const perColumn = (WAVE_WINDOW_SEC * buffer.sampleRate) / WAVE_COLUMNS;
	const peaks: number[] = [];
	for (let c = 0; c < WAVE_COLUMNS; c++) {
		const end = Math.min(Math.floor((c + 1) * perColumn), data.length);
		let max = 0;
		for (let i = Math.floor(c * perColumn); i < end; i++) max = Math.max(max, Math.abs(data[i]));
		peaks.push(Math.min(max, 1));
	}
	return { durationSec: buffer.duration, peaks };
}
