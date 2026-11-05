// 真的分頁頻道（BroadcastChannel，Node 也有）：兩個分頁開的頻道互相聽得到。
import { describe, expect, it, vi } from 'vitest';
import { browserTabChannel } from '#lib/tab-channel.js';

describe('分頁頻道：BroadcastChannel', () => {
	it('送給別的分頁，別的分頁收得到、回得來；自己送的自己收不到', async () => {
		const open = browserTabChannel()!;
		const [mine, other] = [open(), open()];
		const heard = { mine: vi.fn(), other: vi.fn() };
		mine.listen(heard.mine);
		other.listen(heard.other);
		const ask = { kind: 'editing?', id: 'f1' } as const;
		const answer = { kind: 'editing', id: 'f1' } as const;
		mine.post(ask);
		await vi.waitFor(() => expect(heard.other).toHaveBeenCalledWith(ask));
		other.post(answer);
		await vi.waitFor(() => expect(heard.mine).toHaveBeenCalledWith(answer));
		expect(heard.mine).not.toHaveBeenCalledWith(ask);
		mine.close();
		other.close();
	});
});
