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
		mine.post('editing?');
		await vi.waitFor(() => expect(heard.other).toHaveBeenCalledWith('editing?'));
		other.post('editing');
		await vi.waitFor(() => expect(heard.mine).toHaveBeenCalledWith('editing'));
		expect(heard.mine).not.toHaveBeenCalledWith('editing?');
		mine.close();
		other.close();
	});
});
