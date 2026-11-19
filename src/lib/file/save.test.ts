import { describe, expect, it } from 'vitest';
import { flowFileName, safeFileBase, videoFileName } from './save';

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
