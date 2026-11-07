// Delete 只刪最後點的那一個（#204）：最後點的是人時不刪任何東西，跳提示「要刪動作，先點動作」；
// 選了動作再點人，動作表單照舊是那個動作，可以改裡面的人。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { insertFormation } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 範例流程（Lib：小美、小A、小B、小芳）再加一張在 8 秒的站位 2。 */
function setup() {
	const { session, props } = editorPage(flowOf(insertFormation(libSample(), 8)));
	render(Page, props);
	return session;
}

const bar = () => document.querySelector('[data-lane="m1"] [data-action-id="x1"]');
const thumbs = () => screen.queryAllByRole('button', { name: /^站位 \d+$/ });
/** 點泳道上的名字選人。 */
const pickLane = (id: string) => fireEvent.click(document.querySelector(`[data-lane="${id}"] .lab`)!);

describe('Delete 只刪最後點的那一個', () => {
	it('選站位 → 點人 → Delete：站位還在，出現提示', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await pickLane('m2');
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(thumbs()).toHaveLength(2);
		expect(screen.getByRole('status').textContent).toBe('要刪動作，先點動作');
	});

	it('選動作 → 點人 → Backspace：動作還在；動作表單照舊是這個動作，點人改人照舊可用', async () => {
		const session = setup();
		await fireEvent.click(bar()!);
		await pickLane('m2');
		await fireEvent.keyDown(window, { key: 'Backspace' });
		expect(bar()).not.toBeNull();
		expect(session.flow!.actions).toHaveLength(1);
		expect(screen.getByRole('status').textContent).toBe('要刪動作，先點動作');

		await fireEvent.click(screen.getByRole('button', { name: '把 小A 移出這個動作' }));
		expect(session.flow!.actions[0].members.map((m) => m.memberId)).toEqual(['m1', 'm3', 'm4']);
	});

	it('選動作 → 點人 → 再點一次取消那個人：動作還看得到選著，Delete 不刪，出現提示', async () => {
		const session = setup();
		await fireEvent.click(bar()!);
		await pickLane('m2');
		await fireEvent.click(document.querySelector('[data-lane="m2"] .lab')!, { shiftKey: true });
		expect(session.selectedMemberIds).toEqual([]);
		expect(session.selectedAction?.id).toBe('x1');
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(session.flow!.actions).toHaveLength(1);
		expect(screen.getByRole('status').textContent).toBe('要刪動作，先點動作');
	});

	it('最後點的是動作：Delete 刪那個動作', async () => {
		const session = setup();
		await pickLane('m2');
		await fireEvent.click(bar()!);
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(session.flow!.actions).toHaveLength(0);
	});

	it('最後點的是站位：Delete 刪那張站位', async () => {
		setup();
		await pickLane('m2');
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(thumbs()).toHaveLength(1);
	});
});
