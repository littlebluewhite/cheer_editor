// 原因寫成畫面的語言（ADR 0017）：有代號照語言寫，沒代號照中文。
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { addMemberLines, createFlow, deleteMember, type CommandResult, type Flow, type Why, type WhyCode } from '#lib/core';
import { libSample } from './test-flows';
import { reasonText } from './reason-text';

const noFlow = { message: '沒有開著的流程', why: { code: 'commands_no_flow' } } as const;

describe('原因寫成畫面的語言', () => {
	it('有代號：照語言寫', () => {
		expect(reasonText(noFlow)).toBe('沒有開著的流程');
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText(noFlow)).toBe('No routine is open');
	});

	it('還不認得的代號（伺服器比這個分頁新），包在裡面的也是：照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		const later = { code: 'later_reason' } as unknown as Why;
		expect(reasonText({ message: '之後才有的原因', why: later })).toBe('之後才有的原因');
		const inside = { code: 'commands_none', reason: later } as unknown as Why;
		expect(reasonText({ message: '沒有指令', why: inside })).toBe('沒有指令');
	});

	it('清掉的紀錄：英文接在句子後面，前面有空格；刪環節的英文寫成小寫的一句', () => {
		localStorage.setItem(localStorageKey, 'en');
		const segment = { code: 'time_segment_music', n: 1 } as const;
		const deleteSegment = { code: 'segment_order_delete_records', segment, count: 2, undoable: { code: 'records_undoable' } } as const;
		expect(reasonText({ message: '', why: deleteSegment })).toBe(
			'Deleting Music 1 also deletes these and clears 2 reps (Undo brings cleared reps back)'
		);
		const reps = { code: 'records_reps_one', n: 1 } as const;
		const marks = { code: 'records_marks', n: 2 } as const;
		const deletePhase = { code: 'phases_delete_one', count: 1, lost: { code: 'records_loss_both', reps, marks } } as const;
		expect(reasonText({ message: '', why: deletePhase })).toBe(
			'Deleting 1 phase: clears 1 rep and the marks on 2 reps (Undo brings cleared reps back). Confirm to delete'
		);
		const lost = { code: 'records_loss_marks', marks: { code: 'records_marks_one', n: 1 } } as const;
		const onlyMarks = { code: 'phases_delete_one', count: 1, lost } as const;
		expect(reasonText({ message: '', why: onlyMarks })).toBe(
			'Deleting 1 phase: clears the marks on 1 rep (Undo brings cleared reps back). Confirm to delete'
		);
	});

	it('動作的原因：長度範圍帶單位（1 拍單數），撞到的人一串、撞到的動作一個接一個', () => {
		localStorage.setItem(localStorageKey, 'en');
		const range = { code: 'actions_length_range', min: '0.5', max: { code: 'time_length_beat_one', n: 1 } } as const;
		expect(reasonText({ message: '', why: range })).toBe('A skill must be between 0.5 and 1 beat long');
		const clashes = {
			code: 'members_problems',
			first: {
				code: 'actions_clash',
				names: { code: 'members_list', first: '小A', rest: '小B' },
				action: '技巧·Lib',
				where: { code: 'actions_previous_ends', at: '1-5' }
			},
			rest: { code: 'actions_clash', names: '小C', action: '跳躍·跳', where: { code: 'actions_next_starts', at: { code: 'time_seconds', n: '1.0' } } }
		} as const;
		expect(reasonText({ message: '', why: clashes })).toBe(
			'小A, 小B: already in “技巧·Lib” at that time (the previous skill doesn\'t end until 1-5); 小C: already in “跳躍·跳” at that time (the next skill already starts at 1.0 s)'
		);
	});

	it('改動作動到標的拍：切短、刪掉（清掉幾次的記號）、不再記成功率', () => {
		localStorage.setItem(localStorageKey, 'en');
		const one = (code: WhyCode): Why => ({ code, n: 1 });
		const fallout = (will: Why) => ({ code: 'settle_fallout', action: '技巧·Lib', why: { code: 'settle_why_shorter' }, will }) as const;
		const marks = { code: 'phase_beats_dropped_marks', dropped: one('phase_beats_dropped_one'), marks: { code: 'records_marks', n: 2 } } as const;
		expect(reasonText({ message: '', why: fallout({ code: 'phase_beats_and', a: one('phase_beats_cut_one'), b: marks }) })).toBe(
			'Skill “技巧·Lib” gets shorter, which will cut short the marked beats of 1 phase and delete 1 phase (clearing the marks on 2 reps)'
		);
		expect(reasonText({ message: '', why: fallout({ code: 'phase_beats_no_rate', phases: one('phase_beats_dropped_one') }) })).toBe(
			'Skill “技巧·Lib” gets shorter, which will delete 1 phase, so the skill stops recording hit rates'
		);
	});

	it('沒代號（還沒改的）：照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText({ message: '找不到這一段' })).toBe('找不到這一段');
	});
});

describe('隊員的原因（英文）：一句接一句、一行接一行的也照語言寫', () => {
	const said = (r: CommandResult) => {
		if (r.kind === 'ok') throw new Error('沒擋下');
		return r;
	};
	const empty = (): Flow => {
		const r = createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } });
		if (r.kind !== 'ok') throw new Error(r.message);
		return r.flow;
	};

	it('刪隊員：在幾個動作裡、會沒有誰、號碼遞補', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText(said(deleteMember(libSample(), 'm1')))).toBe(
			'Delete athlete “小美” (label 1, 上層): in 1 skill; “技巧·Lib” stunt group 1 will have no 上層; the 3 athletes after them will move up one number'
		);
	});

	it('貼上名單：每一行的錯，名字列在一起', () => {
		localStorage.setItem(localStorageKey, 'en');
		const r = addMemberLines(empty(), '小A\n小B\n小C\t男孩\t主底', { gender: null, globalRole: null });
		expect(reasonText(said(r))).toBe(
			'“小A”, “小B”: Choose a gender; Choose a main role\n“小C”: Gender must be “M” or “F”; “主底” is a position (set per skill); main role must be “base” or “top”'
		);
	});
});
