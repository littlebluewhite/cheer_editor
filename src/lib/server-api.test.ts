// 連伺服器的 adapter（真的，fetch 換成假的）：傳上雲端的流程太大（伺服器收 16 MB 以下）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORMAT_VERSION, type Flow } from '#lib/core';
import { FLOW_TOO_BIG, httpServer } from '#lib/server-api.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

/** 一支流程：name 是 bytes 個字（英文字，一個字一個 byte）。 */
const flowOfSize = (bytes: number) => ({ formatVersion: FORMAT_VERSION, flow: { name: 'x'.repeat(bytes) } as unknown as Flow });

describe('傳上雲端：流程太大', () => {
	it('超過 16 MB：不送，直接說太大', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const made = await httpServer().uploadFlow(flowOfSize(16 * 1024 * 1024));
		expect(made).toEqual({ message: FLOW_TOO_BIG });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('伺服器回 413（例：算法不一樣）：也說太大，不說連不上', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
		const made = await httpServer().uploadFlow(flowOfSize(10));
		expect(made).toEqual({ message: FLOW_TOO_BIG });
	});
});
