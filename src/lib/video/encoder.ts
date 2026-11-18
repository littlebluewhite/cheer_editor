// 流程影片的編碼 adapter：真的用 mediabunny（WebCodecs），測試換成 fake-encoder.ts。
// mediabunny 只在要輸出時才動態載入，編輯器打開時不載。

import { VIDEO_FPS } from '#lib/core';
import { VIDEO_H, VIDEO_W } from './layout';
import { VIDEO_SAMPLE_RATE } from './soundtrack';

export interface VideoJob {
	/** 總共幾格。 */
	frames: number;
	/** 畫第 i 格（i 從 0 起）。 */
	draw: (i: number, canvas: OffscreenCanvas | HTMLCanvasElement) => void;
	/** 混好的聲音；null 是整支沒有聲音。 */
	audio: () => Promise<AudioBuffer | null>;
	/** 已經編好幾格。 */
	onProgress: (done: number) => void;
	signal: AbortSignal;
}

export interface VideoEncoderAdapter {
	/** 這個瀏覽器做不做得出來。影片工具（mediabunny）載不下來時 reject。 */
	supported(): Promise<boolean>;
	/** 回傳 MP4 的位元組。signal 中止時 throw AbortError。 */
	encode(job: VideoJob): Promise<Uint8Array>;
}

/** H.264 Constrained Baseline、level 4.0：手機都播得出來。 */
const VIDEO_CODEC = 'avc1.424028';
const AUDIO_BITRATE = 128000;

interface UserAgentDataNavigator {
	userAgentData?: { brands?: { brand: string }[] };
}

function abortError(): DOMException {
	return new DOMException('已取消輸出', 'AbortError');
}

/** 沒做成的原因：瀏覽器、mediabunny 的訊息是英文，教練看不懂，換成白話（原文對話框另外用小字寫）。 */
export function failureReason(e: unknown): string {
	const name = typeof e === 'object' && e !== null && 'name' in e ? String(e.name) : '';
	const message = e instanceof Error ? e.message : String(e);
	if (name === 'QuotaExceededError' || name === 'RangeError' || /out.of.memory/i.test(message)) return '記憶體不夠，關掉其他分頁再試一次';
	if (name === 'EncodingError' || name === 'NotSupportedError') return '這台電腦的編碼器做不出這支影片';
	return '做影片時出了問題';
}

export function browserVideoEncoder(): VideoEncoderAdapter {
	return {
		async supported() {
			// 只開 Chromium（Chrome、Edge）；別的瀏覽器做不出 AAC
			const brands = (navigator as UserAgentDataNavigator).userAgentData?.brands ?? [];
			if (!brands.some((b) => b.brand === 'Chromium')) return false;
			// 載不下來（離線、部署後舊的檔不在了）不是瀏覽器不行：讓它 reject，對話框另外說
			const { canEncodeVideo, canEncodeAudio, QUALITY_HIGH } = await import('mediabunny');
			try {
				const video = await canEncodeVideo('avc', {
					width: VIDEO_W,
					height: VIDEO_H,
					frameRate: VIDEO_FPS,
					// 跟 encode 一樣的畫質、bitrate 問：只做得出低畫質的編碼器不能過
					quality: QUALITY_HIGH,
					fullCodecString: VIDEO_CODEC
				});
				const audio = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: VIDEO_SAMPLE_RATE, bitrate: AUDIO_BITRATE });
				return video && audio;
			} catch {
				return false;
			}
		},

		async encode(job) {
			const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_HIGH } = await import('mediabunny');
			const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(VIDEO_W, VIDEO_H);
			canvas.width = VIDEO_W;
			canvas.height = VIDEO_H;
			const target = new BufferTarget();
			const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
			const video = new CanvasSource(canvas, {
				codec: 'avc',
				quality: QUALITY_HIGH,
				keyFrameInterval: 2,
				fullCodecString: VIDEO_CODEC
			});
			output.addVideoTrack(video, { frameRate: VIDEO_FPS });
			const soundtrack = await job.audio();
			const audio = soundtrack ? new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
			if (audio) output.addAudioTrack(audio);
			const cancel = async (): Promise<never> => {
				await output.cancel();
				throw abortError();
			};
			try {
				if (job.signal.aborted) return await cancel();
				await output.start();
				for (let i = 0; i < job.frames; i++) {
					if (job.signal.aborted) return await cancel();
					job.draw(i, canvas);
					await video.add(i / VIDEO_FPS, 1 / VIDEO_FPS);
					job.onProgress(i + 1);
				}
				if (job.signal.aborted) return await cancel();
				if (audio && soundtrack) await audio.add(soundtrack);
				// 聲音整軌編好要一點時間：這中間按的取消也不包成 MP4
				if (job.signal.aborted) return await cancel();
				await output.finalize();
			} catch (e) {
				if (!(e instanceof DOMException && e.name === 'AbortError')) await output.cancel().catch(() => {});
				throw e;
			}
			return new Uint8Array(target.buffer!);
		}
	};
}
