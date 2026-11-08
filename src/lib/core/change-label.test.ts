import { describe, expect, it } from 'vitest';
import { flowOf, libSample } from '#lib/test-flows.js';
import {
	addCustomRole,
	addMembers,
	changeLabel,
	deleteAction,
	deleteMember,
	renameFlow,
	splitSegment,
	toSeconds,
	type Flow
} from './index';

const flow = libSample();
const formation = (f: Flow, extra: Partial<Flow['formations'][number]>) => ({ ...f.formations[0], ...extra });

describe('這一步改了什麼', () => {
	it('隊員：加一個寫名字、加好幾個寫人數、刪掉寫名字、改了寫名字', () => {
		const one = flowOf(addMembers(flow, [{ name: '阿強', gender: 'M', globalRole: 'base' }]));
		expect(changeLabel(flow, one)).toBe('加隊員 阿強');
		const two = flowOf(
			addMembers(flow, [
				{ name: '阿強', gender: 'M', globalRole: 'base' },
				{ name: '阿明', gender: 'M', globalRole: 'base' }
			])
		);
		expect(changeLabel(flow, two)).toBe('加 2 位隊員');
		expect(changeLabel(flow, flowOf(deleteMember(flow, 'm2', { confirmed: true })))).toBe('刪隊員 小A');
		const renamed = { ...flow, members: flow.members.map((m) => (m.id === 'm2' ? { ...m, name: '阿A' } : m)) };
		expect(changeLabel(flow, renamed)).toBe('改隊員 阿A');
		expect(changeLabel(flow, { ...flow, members: [...flow.members].reverse() })).toBe('排隊員順序');
	});

	it('站位：插入、刪掉、改了都寫第幾張', () => {
		const two = { ...flow, formations: [...flow.formations, formation(flow, { id: 'f9', at: 32 })] };
		expect(changeLabel(flow, two)).toBe('插入站位 2');
		expect(changeLabel(two, flow)).toBe('刪站位 2');
		const moved = { ...two, formations: [two.formations[0], { ...two.formations[1], at: 40 }] };
		expect(changeLabel(two, moved)).toBe('改站位 2');
	});

	it('動作：新增、刪掉、改了都寫動作名字', () => {
		const gone = flowOf(deleteAction(flow, 'x1', { confirmed: true }));
		expect(changeLabel(flow, gone)).toBe('刪動作 技巧·Lib');
		expect(changeLabel(gone, flow)).toBe('新增動作 技巧·Lib');
		const noted = { ...flow, actions: flow.actions.map((a) => ({ ...a, note: '慢一點' })) };
		expect(changeLabel(flow, noted)).toBe('改動作 技巧·Lib');
	});

	it('段、自訂任務角色、流程名字', () => {
		const chant = { ...flow, segments: [...flow.segments, { id: 's2', kind: 'chant' as const, tenths: 100 }] };
		expect(changeLabel(flow, chant)).toBe('加第 2 段');
		expect(changeLabel(chant, flow)).toBe('刪第 2 段');
		expect(changeLabel(flow, flowOf(addCustomRole(flow, { name: '提手', meaning: '' })))).toBe('加任務角色「提手」');
		expect(changeLabel(flow, flowOf(renameFlow(flow, '決賽')))).toBe('改流程名字');
	});

	describe('改段：寫改了哪一樣，不只寫「改第 N 段」（N62）', () => {
		const music = flow.segments[0];
		const chant = { id: 's2', kind: 'chant' as const, tenths: 100 };
		const both = { ...flow, segments: [music, chant] };
		/** 段的每一格（id、kind 以外）都換一個值：之後多了新的一格，這裡就會抓到。 */
		const another: Record<string, unknown> = { audioId: 'a9', bpm: 99, firstBeatSec: 7, halfBeats: 8, tenths: 50 };
		const fields = [music, chant].flatMap((s, i) =>
			Object.keys(s)
				.filter((k) => k !== 'id' && k !== 'kind')
				.map((k) => [k, i] as const)
		);

		it.each(fields)('改了 %s（段的 index %i）不是泛稱', (key, i) => {
			expect(another).toHaveProperty(key);
			const after = { ...both, segments: both.segments.with(i, { ...both.segments[i], [key]: another[key] }) };
			expect(changeLabel(both, after)).not.toBe(`改第 ${i + 1} 段`);
			expect(changeLabel(both, after)).toContain(`第 ${i + 1} 段`);
		});

		it('音樂：載入、換、拿掉；BPM、第一拍、八拍數、秒數', () => {
			const withAudio = (f: Flow, audioId: string | null) => ({ ...f, segments: [{ ...music, audioId }, chant] });
			expect(changeLabel(withAudio(both, null), withAudio(both, 'a1'))).toBe('載入第 1 段的音樂');
			expect(changeLabel(withAudio(both, 'a1'), withAudio(both, 'a2'))).toBe('換第 1 段的音樂');
			expect(changeLabel(withAudio(both, 'a1'), withAudio(both, null))).toBe('拿掉第 1 段的音樂');
			const one = (patch: object) => ({ ...both, segments: [{ ...music, ...patch }, chant] });
			expect(changeLabel(both, one({ bpm: 99 }))).toBe('改第 1 段的 BPM');
			expect(changeLabel(both, one({ firstBeatSec: 7 }))).toBe('改第 1 段的第一拍');
			expect(changeLabel(both, one({ halfBeats: 8 }))).toBe('改第 1 段的八拍數');
			expect(changeLabel(both, { ...both, segments: [music, { ...chant, tenths: 50 }] })).toBe('改第 2 段的秒數');
		});

		it('切成兩段：寫切了哪一段，不寫「加第 2 段」', () => {
			const cut = flowOf(splitSegment(flow, 's1', toSeconds(flow, { segmentId: 's1', at: 16 })));
			expect(changeLabel(flow, cut)).toBe('把第 1 段切成兩段');
		});
	});
});
