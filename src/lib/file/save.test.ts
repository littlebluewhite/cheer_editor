import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFilePicker, flowFileName, safeFileBase, videoFileName } from './save';

describe('檔名', () => {
	it('流程影片叫「流程名.mp4」，不能用的字換成「_」', () => {
		expect(videoFileName('A/B: C?')).toBe('A_B_ C_.mp4');
	});

	it('流程名是空白，影片叫「流程.mp4」', () => {
		expect(videoFileName('  ')).toBe('流程.mp4');
	});

	it('流程檔照舊叫「流程名.zip」', () => {
		expect(flowFileName('A/B: C?')).toBe('A_B_ C_.zip');
		expect(flowFileName(' .. ')).toBe('流程.zip');
		expect(safeFileBase('', 'x')).toBe('x');
	});
});

describe('選流程檔（Chrome、Edge 的選檔視窗）', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('不篩副檔名：.cheer 也選得到（Android Chrome 篩 application/zip 會藏起來，ADR 0024）', async () => {
		const file = new File([], '練習用.cheer');
		const showOpenFilePicker = vi.fn(async () => [{ getFile: async () => file }]);
		vi.stubGlobal('window', { showOpenFilePicker });
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		const picked = await browserFilePicker()!();
		expect(picked?.file).toBe(file);
		expect(showOpenFilePicker).toHaveBeenCalledWith({});
	});
});
