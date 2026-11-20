// 原因寫成畫面的語言（ADR 0017）：有代號照語言寫，沒代號照中文。
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import type { Why } from '#lib/core';
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

	it('沒代號（還沒改的）：照中文', () => {
		localStorage.setItem(localStorageKey, 'en');
		expect(reasonText({ message: '找不到這一段' })).toBe('找不到這一段');
	});
});
