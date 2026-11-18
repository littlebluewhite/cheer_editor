import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserVideoEncoder, failureReason } from './encoder';

describe('failureReason', () => {
	it('記憶體不夠：QuotaExceededError、RangeError、訊息寫 out of memory', () => {
		const memory = '記憶體不夠，關掉其他分頁再試一次';
		expect(failureReason(new DOMException('quota', 'QuotaExceededError'))).toBe(memory);
		expect(failureReason(new RangeError('Array buffer allocation failed'))).toBe(memory);
		expect(failureReason(new Error('Encoder failed: out of memory'))).toBe(memory);
		expect(failureReason(new DOMException('Out-of-memory', 'EncodingError'))).toBe(memory);
	});

	it('編碼器做不出來：EncodingError、NotSupportedError', () => {
		const codec = '這台電腦的編碼器做不出這支影片';
		expect(failureReason(new DOMException('Encoding error.', 'EncodingError'))).toBe(codec);
		expect(failureReason(new DOMException('Unsupported configuration', 'NotSupportedError'))).toBe(codec);
	});

	it('其他：一般的說法', () => {
		expect(failureReason(new Error('something broke'))).toBe('做影片時出了問題');
		expect(failureReason('字串')).toBe('做影片時出了問題');
		expect(failureReason(null)).toBe('做影片時出了問題');
	});
});

describe('browserVideoEncoder（mediabunny 換成假的：jsdom 沒有 WebCodecs）', () => {
	afterEach(() => {
		vi.doUnmock('mediabunny');
		vi.unstubAllGlobals();
	});

	it('編聲音時按取消：不包成 MP4，丟掉做到一半的，throw AbortError', async () => {
		const run = new AbortController();
		const finalize = vi.fn(async () => {});
		const cancel = vi.fn(async () => {});
		vi.stubGlobal('OffscreenCanvas', class {});
		vi.doMock('mediabunny', () => ({
			Output: class {
				addVideoTrack() {}
				addAudioTrack() {}
				async start() {}
				finalize = finalize;
				cancel = cancel;
			},
			Mp4OutputFormat: class {},
			BufferTarget: class {
				buffer = new ArrayBuffer(1);
			},
			CanvasSource: class {
				async add() {}
			},
			AudioBufferSource: class {
				async add() {
					run.abort();
				}
			},
			QUALITY_HIGH: {}
		}));
		const job = { frames: 1, draw: () => {}, audio: async () => ({}) as AudioBuffer, onProgress: () => {}, signal: run.signal };
		await expect(browserVideoEncoder().encode(job)).rejects.toMatchObject({ name: 'AbortError' });
		expect(finalize).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('問做不做得出來：用跟真的編碼一樣的畫質、聲音的 bitrate 問', async () => {
		const QUALITY_HIGH = { high: true };
		const canEncodeVideo = vi.fn(async () => true);
		const canEncodeAudio = vi.fn(async () => true);
		vi.stubGlobal('navigator', { userAgentData: { brands: [{ brand: 'Chromium' }] } });
		vi.doMock('mediabunny', () => ({ canEncodeVideo, canEncodeAudio, QUALITY_HIGH }));
		expect(await browserVideoEncoder().supported()).toBe(true);
		expect(canEncodeVideo).toHaveBeenCalledWith('avc', expect.objectContaining({ quality: QUALITY_HIGH }));
		expect(canEncodeAudio).toHaveBeenCalledWith('aac', expect.objectContaining({ bitrate: 128000 }));
	});
});
