// 給教練看的原因寫成畫面的語言（ADR 0017）：有代號照 messages/*.json 的句子寫，沒代號（還沒改的）照中文。
import { m } from '#lib/paraglide/messages.js';
import type { Said, Why, WhyCode } from '#lib/core';

type Sentence = (inputs: Record<string, string | number>) => string;

/** 每個代號都要有同名的句子（少了型別檢查會抓到）。 */
const SENTENCES: Record<WhyCode, unknown> = m;

/** 原因寫成畫面的語言：包著的原因也是。 */
export function whyText(why: Why): string {
	const inputs: Record<string, string | number> = {};
	for (const [name, v] of Object.entries(why)) inputs[name] = typeof v === 'object' ? whyText(v) : v;
	return (SENTENCES[why.code] as Sentence)(inputs);
}

/** 給教練看的原因：有代號寫成畫面的語言，沒有照中文。 */
export const reasonText = ({ message, why }: Said): string => (why ? whyText(why) : message);
