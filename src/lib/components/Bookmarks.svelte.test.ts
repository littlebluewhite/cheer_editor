import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { addAction, addBookmark, addMembers, addSegment, createFlow, updateSegment, type Flow } from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import { testEditor } from '#lib/test-fakes.js';
import TestSession from '#lib/TestSession.svelte';
import Bookmarks from './Bookmarks.svelte';

// 這個檔用編號的 id（k1、x1…）找東西：不算步驟 id（同 SegmentSettings.svelte.test.ts）。
vi.mock('#lib/core/ids.js', async (load) => ({
	...(await load<typeof import('#lib/core/ids.js')>()),
	inStep: <R>(_stepId: string, run: () => R) => run()
}));

/** 120 BPM 一段 4 個八拍（一個半拍 0.25 秒）；書籤「後面」只有 A（3-1，8 秒），「翻騰」1-5 到 2-1（2 到 4 秒）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { bpm: 120, eights: 4, lastBeats: 8 }));
	flow = flowOf(addBookmark(flow, '後面', { segmentId: 's1', at: 32 }, null));
	return flowOf(addBookmark(flow, '翻騰', { segmentId: 's1', at: 8 }, { segmentId: 's1', at: 16 }));
}

function setup(flow: Flow, place: 'bar' | 'phone' = 'bar') {
	const { editor, session } = testEditor(flow);
	render(TestSession, { props: { editor, component: Bookmarks, props: { place } } });
	return { editor, session, playback: editor.playback };
}

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('書籤', () => {
	it('照 A 的時間排', () => {
		setup(sample());
		const names = screen.getAllByRole('button').map((b) => b.textContent);
		expect(names.indexOf('⟳翻騰')).toBeLessThan(names.indexOf('↦後面'));
	});

	it('點有 B 的：重複範圍換成 A 到 B、重複打開、播放頭跳到 A；再點一下關掉重複', async () => {
		const { playback } = setup(sample());
		await fireEvent.click(chip('翻騰'));
		expect(playback.range).toEqual({ a: 2, b: 4 });
		expect(playback.repeat).toBe(true);
		expect(playback.sec).toBe(2);
		expect(chip('翻騰').getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(chip('翻騰'));
		expect(playback.repeat).toBe(false);
		expect(playback.range).toEqual({ a: 2, b: 4 });
	});

	it('點只有 A 的：播放頭跳到 A，重複範圍不動', async () => {
		const { playback } = setup(sample());
		await fireEvent.click(chip('翻騰'));
		await fireEvent.click(chip('後面'));
		expect(playback.sec).toBe(8);
		expect(playback.range).toEqual({ a: 2, b: 4 });
	});

	it('重複開著、停著點只有 A 的：按播放從書籤的 A 播，不是重複範圍的 A', async () => {
		const { playback } = setup(sample());
		await fireEvent.click(chip('翻騰'));
		await fireEvent.click(chip('後面'));
		expect(playback.repeat).toBe(false);
		expect(playback.range).toEqual({ a: 2, b: 4 });
		playback.play();
		expect(playback.sec).toBe(8);
		playback.pause();
	});

	it('重複開著、只有 A 的在範圍裡面：重複照開，播放頭跳到 A', async () => {
		const { playback } = setup(flowOf(addBookmark(sample(), '中間', { segmentId: 's1', at: 12 }, null)));
		await fireEvent.click(chip('翻騰'));
		await fireEvent.click(chip('中間'));
		expect(playback.repeat).toBe(true);
		expect(playback.sec).toBe(3);
	});

	it('重複開著、播放中點只有 A 的：從書籤的 A 接著播', async () => {
		const { playback } = setup(sample());
		await fireEvent.click(chip('翻騰'));
		playback.play();
		await fireEvent.click(chip('後面'));
		expect(playback.playing).toBe(true);
		expect(playback.sec).toBe(8);
		playback.pause();
	});

	it('存：現在的 A、B；A 剛好是動作的開頭就先填動作名字', async () => {
		let flow = flowOf(addMembers(sample(), [{ name: '小A', gender: 'F', globalRole: 'top' }]));
		const members = [{ memberId: 'm1', role: '騰翻' }];
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '後空翻', start: 48, length: 8, note: '', members }));
		const { session, playback } = setup(flow);
		playback.setRange(12, 14);
		await fireEvent.click(screen.getByRole('button', { name: /存成書籤/ }));
		const input = screen.getByRole('textbox', { name: '書籤名字' }) as HTMLInputElement;
		expect(input.value).toBe('後空翻');
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(session.flow!.bookmarks!.at(-1)).toMatchObject({
			name: '後空翻',
			a: { segmentId: 's1', at: 48 },
			b: { segmentId: 's1', at: 56 }
		});
	});

	it('存一樣的 A、B：擋下，提示說已經有哪個', async () => {
		const { session, playback } = setup(sample());
		playback.setRange(2, 4);
		await fireEvent.click(screen.getByRole('button', { name: /存成書籤/ }));
		await fireEvent.input(screen.getByRole('textbox', { name: '書籤名字' }), { target: { value: '又一個' } });
		await fireEvent.keyDown(screen.getByRole('textbox', { name: '書籤名字' }), { key: 'Enter' });
		expect(session.flow!.bookmarks).toHaveLength(2);
		expect(session.notice).toBe('這裡已經有書籤「翻騰」了');
	});

	it('手機：只有書籤，沒有存、管理；沒有書籤就不出現', () => {
		setup(sample(), 'phone');
		expect(screen.queryByRole('button', { name: /存成書籤/ })).toBeNull();
		expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
		document.body.innerHTML = '';
		setup(flowOf(addSegment(flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } })), 'music')), 'phone');
		expect(screen.queryByRole('group', { name: '書籤' })).toBeNull();
	});

	it('檢視模式：存、管理還在但變灰（上方列不跑），書籤照樣點得到', async () => {
		const { session, playback } = setup(sample());
		session.viewing = true;
		await fireEvent.click(chip('翻騰'));
		expect(playback.range).toEqual({ a: 2, b: 4 });
		expect((screen.getByRole('button', { name: /存成書籤/ }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: '管理' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('上方列窄（1440 寬以下）：收成一顆「書籤」鈕，點了開小窗；點書籤就跳過去、小窗收起來', async () => {
		vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }));
		try {
			const { playback } = setup(sample());
			expect(screen.queryByRole('button', { name: /翻騰/ })).toBeNull();
			await fireEvent.click(screen.getByRole('button', { name: '書籤' }));
			expect(screen.getByRole('button', { name: /存成書籤/ })).toBeTruthy();
			await fireEvent.click(chip('翻騰'));
			expect(playback.range).toEqual({ a: 2, b: 4 });
			expect(screen.queryByRole('button', { name: /翻騰/ })).toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('管理：改名、刪', async () => {
		const { session } = setup(sample());
		await fireEvent.click(screen.getByRole('button', { name: '管理' }));
		await fireEvent.click(screen.getByRole('button', { name: '改書籤「翻騰」的名字' }));
		const input = screen.getByRole('textbox', { name: '書籤名字' });
		await fireEvent.input(input, { target: { value: '開場翻' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(session.flow!.bookmarks!.map((b) => b.name)).toEqual(['後面', '開場翻']);
		await fireEvent.click(screen.getByRole('button', { name: '刪書籤「後面」' }));
		expect(session.flow!.bookmarks!.map((b) => b.name)).toEqual(['開場翻']);
	});
});
