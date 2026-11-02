import { describe, expect, it } from 'vitest';
import { createFlow } from './index';

describe('建立流程', () => {
	it('有名字和場地就建好一支流程', () => {
		const r = createFlow({ name: '2027 全國賽', field: { strips: 5, layout: 'horizontal' } });
		expect(r).toEqual({
			kind: 'ok',
			flow: { name: '2027 全國賽', field: { strips: 5, layout: 'horizontal' } }
		});
	});

	it.each([0, 13, 2.5, Number.NaN])('條數 %s 不在 1–12 之間就擋下', (strips) => {
		const r = createFlow({ name: '測試', field: { strips, layout: 'vertical' } });
		expect(r).toEqual({ kind: 'blocked', message: '條數要是 1–12 的整數' });
	});

	it('自訂 1 條和 12 條都可以', () => {
		expect(createFlow({ name: '測試', field: { strips: 1, layout: 'vertical' } }).kind).toBe('ok');
		expect(createFlow({ name: '測試', field: { strips: 12, layout: 'horizontal' } }).kind).toBe(
			'ok'
		);
	});

	it('沒有名字就擋下；名字前後的空白去掉', () => {
		const field = { strips: 9, layout: 'vertical' } as const;
		expect(createFlow({ name: '  ', field })).toEqual({
			kind: 'blocked',
			message: '請幫流程取名字'
		});
		const r = createFlow({ name: ' 臺灣盃 ', field });
		expect(r.kind === 'ok' && r.flow.name).toBe('臺灣盃');
	});
});
