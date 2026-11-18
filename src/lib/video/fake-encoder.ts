// 測試用的假編碼器：不畫圖、不混聲音（jsdom 沒有 canvas），只記畫了哪幾格。
// release() 之前停在最後一格前，測試才看得到「輸出中」。

import type { VideoEncoderAdapter, VideoJob } from './encoder';

export function createFakeVideoEncoder(o: { supported?: boolean; fail?: string } = {}): VideoEncoderAdapter & {
	drawn: number[];
	aborted: boolean;
	release(): void;
} {
	let release = () => {};
	const released = new Promise<void>((resolve) => (release = resolve));
	const fake = {
		drawn: [] as number[],
		aborted: false,
		release: () => release(),
		async supported() {
			return o.supported ?? true;
		},
		async encode(job: VideoJob) {
			const abort = () => {
				fake.aborted = true;
				return new DOMException('已取消輸出', 'AbortError');
			};
			for (let i = 0; i < job.frames; i++) {
				if (job.signal.aborted) throw abort();
				if (i === job.frames - 1) {
					// 停著的時候取消也要醒來，不然沒人 release() 就卡死
					await Promise.race([
						released,
						new Promise<void>((resolve) => job.signal.addEventListener('abort', () => resolve(), { once: true }))
					]);
					if (job.signal.aborted) throw abort();
				}
				// 失敗在第一格：還沒畫就失敗
				if (o.fail !== undefined) throw new Error(o.fail);
				fake.drawn.push(i);
				job.onProgress(i + 1);
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			return new Uint8Array([0, 0, 0, 1]);
		}
	};
	return fake;
}
