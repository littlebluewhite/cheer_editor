// 給教練看的原因寫成畫面的語言（ADR 0017）：有代號照 messages/*.json 的句子寫，沒代號（還沒改的）照中文。
import { m } from '#lib/paraglide/messages.js';
import { FIXED_ROLES, roleWhy, said, type Said, type Why, type WhyCode, type WhyParam } from '#lib/core';

type Sentence = (inputs: Record<string, string | number>) => string;

/** 每個代號都要有同名的句子（少了型別檢查會抓到）。 */
const SENTENCES: Record<WhyCode, unknown> = m;

/** 這個分頁認得的代號（包著的原因也是）：伺服器比分頁新時可能有還不認得的。 */
const known = (why: Why): boolean =>
	why.code in SENTENCES && Object.values(why).every((v) => typeof v !== 'object' || known(v));

/** 原因寫成畫面的語言：包著的原因也是。 */
function write(why: Why): string {
	const inputs: Record<string, string | number> = {};
	for (const [name, v] of Object.entries(why)) inputs[name] = typeof v === 'object' ? write(v) : v;
	return (SENTENCES[why.code] as Sentence)(inputs);
}

/** 給教練看的原因：有代號寫成畫面的語言；沒有代號、或有還不認得的代號（伺服器比這個分頁新），照中文。 */
export const reasonText = ({ message, why }: Said): string => (why && known(why) ? write(why) : message);

/** 流程核心給的字（代號，或還沒改的中文；例：大類、任務角色的名字）寫成畫面的語言。 */
export const whyText = (text: WhyParam): string => (typeof text === 'object' ? reasonText(said(text)) : String(text));

/**
 * 任務角色的名字照畫面語言寫。自訂的名字跟固定的任務角色寫出來一樣（英文畫面自訂一個叫 Base，底層也寫 Base；不分大小寫）時，
 * 後面標「（自訂）」才分得出來。中文畫面自訂的不能跟固定的同名，所以不會標。
 */
export function roleText(name: string): string {
	const why = roleWhy(name);
	const text = whyText(why);
	if (typeof why === 'object') return text;
	const same = (fixed: string) => whyText(roleWhy(fixed)).toLowerCase() === text.toLowerCase();
	return FIXED_ROLES.some((r) => same(r.name)) ? m.roles_custom_name({ name: text }) : text;
}

/** 一串字接成一句：兩個兩個用 sentence 接（預設是名單的「、」，英文「, 」）。parts 不能是空的。 */
export const joinText = (parts: string[], sentence: (inputs: { first: string; rest: string }) => string = m.members_list): string =>
	parts.reduceRight((rest, first) => sentence({ first, rest }));
