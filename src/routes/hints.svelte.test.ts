// 頁面：只提醒、不擋的黃字（疊在同一點的人）。
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { setPositions } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

describe('提醒：疊在同一點', () => {
	it('播放頭這一拍有人站在同一點，左邊欄寫出是誰；分開了就不寫', () => {
		const flow = teamFlow();
		const stacked = flowOf(setPositions(flow, flow.formations[0].id, { m1: [1, 1], m2: [1, 1], m3: [0, 0], m4: [2, 0] }));
		render(Page, editorPage(stacked).props);
		expect(screen.getByRole('note').textContent).toContain('小美、小A 疊在同一點');
	});

	it('沒有人疊在一起就沒有提醒', () => {
		const flow = teamFlow();
		const apart = flowOf(setPositions(flow, flow.formations[0].id, { m1: [1, 1], m2: [0, 1], m3: [0, 0], m4: [2, 0] }));
		render(Page, editorPage(apart).props);
		expect(screen.queryByText(/疊在同一點/)).toBeNull();
	});
});
