import { describe, expect, it } from 'vitest';
import { createFakeVideoEncoder } from './fake-encoder';

describe('假的影片編碼器', () => {
	it('停在最後一格前，取消時不用 release() 就以 AbortError 結束', async () => {
		const encoder = createFakeVideoEncoder();
		const controller = new AbortController();
		const result = encoder
			.encode({ frames: 3, draw: () => {}, audio: async () => null, onProgress: () => {}, signal: controller.signal })
			.then(
				() => null,
				(e: unknown) => e
			);
		await new Promise((r) => setTimeout(r, 20));
		expect(encoder.drawn).toEqual([0, 1]);
		controller.abort();
		const error = await result;
		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe('AbortError');
		expect(encoder.aborted).toBe(true);
		expect(encoder.drawn).not.toContain(2);
	});
});
