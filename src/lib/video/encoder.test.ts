import { describe, expect, it } from 'vitest';
import { failureReason } from './encoder';

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
