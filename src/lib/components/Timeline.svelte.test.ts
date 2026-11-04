import { addSegment, createFlow, type CommandResult, type Flow } from '#lib/core';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Timeline from './Timeline.svelte';
import { Ask } from './ask.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

function setup() {
	const flow = flowOf(
		addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music')
	);
	const { container } = render(Timeline, {
		flow,
		playheadSec: 0,
		onseek: () => {},
		onaddsegment: () => {},
		onopensegment: () => {},
		ask: new Ask(() => {})
	});
	return container.querySelector('.timeline') as HTMLElement;
}

describe('時間軸放大縮小', () => {
	it('按「＋」「−」改倍數，畫面上看得到現在幾倍', async () => {
		setup();
		expect(screen.getByText('×1')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸放大' }));
		expect(screen.getByText('×1.5')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '時間軸縮小' }));
		await fireEvent.click(screen.getByRole('button', { name: '時間軸縮小' }));
		expect(screen.getByText('×0.75')).toBeTruthy();
	});

	it('Ctrl／⌘＋滾輪放大縮小；沒按 Ctrl／⌘ 的滾輪不動倍數', async () => {
		const timeline = setup();
		await fireEvent.wheel(timeline, { deltaY: -100 });
		expect(screen.getByText('×1')).toBeTruthy();
		await fireEvent.wheel(timeline, { deltaY: -100, ctrlKey: true });
		expect(screen.getByText('×1.5')).toBeTruthy();
		await fireEvent.wheel(timeline, { deltaY: 100, metaKey: true });
		await fireEvent.wheel(timeline, { deltaY: 100, metaKey: true });
		expect(screen.getByText('×0.75')).toBeTruthy();
	});

	it('iPad 兩指捏合（Safari 的 gesturechange）放大縮小時間軸，不放大整頁', async () => {
		const timeline = setup();
		const gesture = async (type: string, scale: number) => {
			const e = Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 300 });
			await fireEvent(timeline, e);
			return e;
		};
		expect((await gesture('gesturestart', 1)).defaultPrevented).toBe(true);
		await gesture('gesturechange', 1.1);
		expect(screen.getByText('×1')).toBeTruthy();
		expect((await gesture('gesturechange', 1.4)).defaultPrevented).toBe(true);
		expect(screen.getByText('×1.5')).toBeTruthy();
		await gesture('gesturechange', 1.4 / 1.3 / 1.3 / 1.01);
		expect(screen.getByText('×1')).toBeTruthy();
	});

	it('觸控板捏合的小事件累積夠了才動一格', async () => {
		const timeline = setup();
		await fireEvent.wheel(timeline, { deltaY: -15, ctrlKey: true });
		await fireEvent.wheel(timeline, { deltaY: -15, ctrlKey: true });
		expect(screen.getByText('×1')).toBeTruthy();
		await fireEvent.wheel(timeline, { deltaY: -15, ctrlKey: true });
		expect(screen.getByText('×1.5')).toBeTruthy();
	});
});
