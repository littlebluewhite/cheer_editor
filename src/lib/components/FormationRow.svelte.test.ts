import { addSegment, createFlow, insertFormation, type CommandResult, type Flow } from '#lib/core';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import FormationRow from './FormationRow.svelte';

function ok(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

describe('站位列的小圖', () => {
	it('跟下一張站位靠太近時變窄，不蓋到下一張；再近也留得下號碼；最後一張照原本寬', () => {
		let flow = ok(addSegment(ok(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
		for (const sec of [4, 20, 21]) flow = ok(insertFormation(flow, sec));
		const { container } = render(TestSession, {
			props: { session: new EditorSession(flow), component: FormationRow, props: { pxPerSec: 16, onseek: () => {} } }
		});
		const widths = [...container.querySelectorAll<HTMLElement>('.th')].map((t) => t.style.width);
		// 0 秒和 4 秒差 64 px → 60 px；4 和 20 差很遠 → 80；20 和 21 只差 16 px → 最窄 44；最後一張 80。
		expect(widths).toEqual(['60px', '80px', '44px', '80px']);
	});
});
