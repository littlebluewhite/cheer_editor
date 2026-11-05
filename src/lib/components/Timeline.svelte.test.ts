import { addSegment, createFlow, updateSegment } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import Timeline from './Timeline.svelte';

function setup() {
	const flow = flowOf(
		addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music')
	);
	const { container } = render(TestSession, {
		props: {
			session: new EditorSession(flow),
			component: Timeline,
			props: { playheadSec: 0, onseek: () => {}, onopensegment: () => {} }
		}
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

describe('段列', () => {
	/** 一個音樂段後面接一個 0.1 秒的口號段。 */
	function setupShortChant() {
		let flow = flowOf(addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
		flow = flowOf(addSegment(flow, 'chant'));
		flow = flowOf(updateSegment(flow, flow.segments[1].id, { seconds: 0.1 }));
		render(TestSession, {
			props: {
				session: new EditorSession(flow),
				component: Timeline,
				props: { playheadSec: 0, onseek: () => {}, onopensegment: () => {} }
			}
		});
	}

	it('段上的字放不下時，滑過去看得到完整的字', () => {
		setupShortChant();
		expect(screen.getByRole('button', { name: /^音樂 1/ }).title).toMatch(/^音樂 1　\d+ BPM/);
		expect(screen.getByRole('button', { name: /^口號 1/ }).title).toMatch(/^口號 1　0\.1 秒/);
	});

	it('很短的段也有點得到的寬度', () => {
		setupShortChant();
		expect(parseFloat(screen.getByRole('button', { name: /^口號 1/ }).style.width)).toBeGreaterThanOrEqual(16);
	});
});
