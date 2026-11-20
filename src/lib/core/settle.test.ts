// 改動作的後果要問教練時怎麼問（falloutQuestion）：指令走不到的組合直接問這裡。
import { describe, expect, it } from 'vitest';
import { falloutQuestion } from './settle';
import { ratedSample } from '../test-flows';

describe('改動作的後果怎麼問', () => {
	it('拍點有動到、卻沒有原因（沒變短、沒換人、沒拖到半拍上）：只寫動作，不寫原因', () => {
		const flow = ratedSample();
		const x1 = flow.actions[0];
		const cues = { removed: 1, cut: 0, orphaned: 0, items: [{ code: 'cues_item_removed' as const, cue: { code: 'cues_text' as const, kind: { code: 'cues_kind_count' as const }, word: 'down', span: '1-1' } }] };
		expect(falloutQuestion(flow, x1, x1, cues, { phases: null, lost: [], changed: [] }, {})).toEqual({
			kind: 'confirm',
			message: '動作「技巧·Lib」，會拿掉 1 個拍點',
			why: { code: 'settle_fallout_no_cause', action: { code: 'action_label', category: { code: 'category_stunt' }, name: 'Lib' }, will: { code: 'settle_cues_removed_one', n: 1 } },
			items: ['拿掉：拍子 down 1-1'],
			whyItems: cues.items
		});
	});
});
