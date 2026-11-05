// 音訊薄層：把音樂檔解碼，拿到長度、整首的波形和播放用的 AudioBuffer。
// jsdom 沒有 Web Audio，所以元件把 decode 收成 prop，測試換成假的。

/** 波形每秒切成幾欄，每欄取最大振幅。段設定只畫段用到的那一截。 */
export const PEAKS_PER_SEC = 30;

export interface DecodedAudio {
	durationSec: number;
	/** 整首每秒切成 PEAKS_PER_SEC 欄，每欄的最大振幅（0–1）。第 i 欄從第 i / PEAKS_PER_SEC 秒開始。 */
	peaks: number[];
	/** 播放用。測試的假解碼沒有，那一段就不出聲。 */
	buffer?: AudioBuffer;
}

/** 畫面留著的一個音樂檔：原始位元組（存檔用）＋解碼結果。用流程裡的 audioId 對應。 */
export interface LoadedAudio extends DecodedAudio {
	bytes: ArrayBuffer;
	/** 這個瀏覽器解不開（檔案壞了、不支援的編碼）：位元組照樣存回去，長度、波形都沒有。 */
	broken?: true;
}

let context: AudioContext | null = null;

/** 解碼和播放共用一個 AudioContext。 */
export function sharedAudioContext(): AudioContext {
	// iPad、iPhone 開了靜音時，網頁的聲音預設也會靜音；設成 playback 才照樣出聲（Safari 16.4 起才有）。
	const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
	if (session) session.type = 'playback';
	context ??= new AudioContext();
	return context;
}

export async function decodeAudio(bytes: ArrayBuffer): Promise<DecodedAudio> {
	// decodeAudioData 會把傳進去的 ArrayBuffer 拿走，所以給一份複本，原本的留著存檔。
	const buffer = await sharedAudioContext().decodeAudioData(bytes.slice(0));
	const data = buffer.getChannelData(0);
	const perColumn = buffer.sampleRate / PEAKS_PER_SEC;
	const peaks: number[] = [];
	for (let c = 0; c < Math.ceil(data.length / perColumn); c++) {
		const end = Math.min(Math.floor((c + 1) * perColumn), data.length);
		let max = 0;
		for (let i = Math.floor(c * perColumn); i < end; i++) max = Math.max(max, Math.abs(data[i]));
		peaks.push(Math.min(max, 1));
	}
	return { durationSec: buffer.duration, peaks, buffer };
}
