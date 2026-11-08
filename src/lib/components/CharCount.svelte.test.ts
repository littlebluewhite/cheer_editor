// 欄位旁邊的字數（CharCount）和流程核心的 tooLong 只有一條規則（N08）：同樣的資料，欄位留下打的字 ⇔ 核心照收。
// 規則本身（舊的字可以超過上限，改了不能更長）的例子在 src/lib/core/text-length.test.ts。
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { tooLong } from '#lib/core';
import CharCount from './CharCount.svelte';

afterEach(() => document.body.replaceChildren());

const chars = (n: number) => '字'.repeat(n);

/** [情況, 原本的字（流程裡的）, 一下一下打成的字]：隊員名字，上限 20。 */
const CASES: [string, string, string[]][] = [
	['上限內打到上限', chars(5), [chars(20)]],
	['上限內打超過', chars(5), [chars(21)]],
	['舊檔超過、刪一個字', chars(25), [chars(24)]],
	['舊檔超過、刪一個字又打回來', chars(25), [chars(24), chars(25)]],
	['舊檔超過、再打一個字', chars(25), [chars(26)]],
	['舊檔超過、刪到上限內再打長', chars(25), [chars(10), chars(22)]]
];

describe('CharCount 跟 tooLong 一樣', () => {
	it.each(CASES)('%s', async (_, before, steps) => {
		const input = document.createElement('input');
		input.value = before;
		document.body.append(input);
		render(CharCount, { props: { field: 'memberName', input, value: before } });
		input.focus();
		for (const step of steps) await fireEvent.input(input, { target: { value: step } });
		const typed = steps.at(-1)!;
		const kept = input.value === typed;
		expect(kept).toBe(tooLong('memberName', typed, before) === null);
	});
});
