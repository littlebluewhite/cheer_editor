// 記一次全上的表：放一個真的 session 進去，點格子、存，讀 session 的流程。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { ratedSample } from '#lib/test-flows.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import TestSession from '#lib/TestSession.svelte';
import RunThroughSheet from './RunThroughSheet.svelte';

const DATE = '2026-11-01';

/** 畫全上表（Lib 第 1 組小美、第 2 組小芳；騰翻小美、小A），回傳 session 和關掉的 callback。 */
function setup() {
	const session = new EditorSession(ratedSample());
	const onclose = vi.fn();
	render(TestSession, { props: { session, component: RunThroughSheet, props: { date: DATE, onclose } } });
	return { session, onclose };
}

/** 一個動作存下來的每一次：記號和練法。 */
const records = (session: EditorSession, index: number) =>
	session.flow!.actions[index].successRate!.records.map((r) => ({ date: r.date, practice: r.practice, marks: r.marks }));
const slot = (who: string, phase: string) => screen.getByRole('button', { name: new RegExp(`^${who} ${phase} `) });
const stopped = (label: string) =>
	within(screen.getByRole('region', { name: label })).getByRole('button', { name: '沒做（停了）' });

describe('記一次全上的表', () => {
	it('第 2 組下法點成 ✗、騰翻沒做，存：session 的流程裡 Lib 每組多一次全上，騰翻沒有；表關掉；不算復原的一步', async () => {
		const { session, onclose } = setup();
		await fireEvent.click(slot('第 2 組 小芳', '下法'));
		await fireEvent.click(slot('第 2 組 小芳', '下法'));
		await fireEvent.click(stopped('騰翻'));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));

		expect(records(session, 0)).toEqual([
			{ date: DATE, practice: 'runThrough', marks: { p1: '✓', p2: '✓', p3: '✓' } },
			{ date: DATE, practice: 'runThrough', marks: { p1: '✓', p2: '✓', p3: '✗' } }
		]);
		expect(records(session, 1)).toEqual([]);
		expect(onclose).toHaveBeenCalledOnce();
		expect(session.canUndo).toBe(false);
	});

	it('中段點成 ✗：存下來的那一次後面空著', async () => {
		const { session } = setup();
		await fireEvent.click(slot('第 1 組 小美', '中段'));
		await fireEvent.click(slot('第 1 組 小美', '中段'));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));
		expect(records(session, 0)[0].marks).toEqual({ p1: '✓', p2: '✗' });
	});

	it('每個動作都沒做：擋下來說原因，session 的流程不變，表還開著', async () => {
		const { session, onclose } = setup();
		const before = session.flow;
		await fireEvent.click(stopped('技巧·Lib'));
		await fireEvent.click(stopped('騰翻'));
		await fireEvent.click(screen.getByRole('button', { name: '存這次全上' }));

		expect(screen.getByRole('alert').textContent).toBe('每個動作都沒做，沒有要存的');
		expect(session.flow).toBe(before);
		expect(onclose).not.toHaveBeenCalled();
	});
});
