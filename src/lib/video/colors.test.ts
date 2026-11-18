// 影片的顏色要跟編輯器一樣：讀 Field.svelte、app.css、EightCountCueLine.svelte 的原始碼比對（跟 source-guards.test.ts 同一種做法）。
// 影片永遠用淺色的那一套，所以變數取 app.css 裡第一次出現的值。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIDEO_COLORS, type ColorKey } from './colors';

const SRC = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const field = read('lib/components/Field.svelte');
const cueLine = read('lib/components/EightCountCueLine.svelte');
const css = read('app.css');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** app.css 的變數值。 */
function variable(name: string): string {
	const m = css.match(new RegExp(`${escape(name)}:\\s*([^;]+);`));
	if (!m) throw new Error(`app.css 沒有 ${name}`);
	return m[1].trim();
}

/** 一條 CSS 規則（selector { … }）裡某個屬性的值；var(--x, 備用) 換成 app.css 的 --x。 */
function rule(source: string, selector: string, prop: string): string {
	const block = source.match(new RegExp(`\\n\\t+${escape(selector)}\\s*\\{([^}]*)\\}`));
	if (!block) throw new Error(`找不到規則 ${selector}`);
	const decl = block[1].match(new RegExp(`(?:^|[\\s;])${escape(prop)}:\\s*([^;]+);`));
	if (!decl) throw new Error(`${selector} 沒有 ${prop}`);
	const v = decl[1].trim();
	const ref = v.match(/^var\((--[\w-]+)/);
	return ref ? variable(ref[1]) : v;
}

const fieldRule = (selector: string, prop: string) => () => rule(field, selector, prop);
const cssVar = (name: string) => () => variable(name);

/** 每個顏色在原始碼裡的樣子。 */
const SOURCES: Record<ColorKey, () => string> = {
	bg: cssVar('--surface'),
	ink: cssVar('--ink'),
	muted: cssVar('--muted'),
	beatIdle: cssVar('--line-soft'),
	beatIdleInk: cssVar('--muted'),
	beatLit: cssVar('--now'),
	beatLitInk: cssVar('--surface'),
	beatOff: cssVar('--surface-2'),
	beatOffInk: cssVar('--line'),
	gridLine: cssVar('--line'),
	gridNow: cssVar('--warn-bg'),
	cueDown: cssVar('--cue-down'),
	cueUp: cssVar('--cue-up'),
	cueCountInk: cssVar('--surface'),
	cueStepBg: cssVar('--cue-step-bg'),
	cueStepLine: cssVar('--cue-step-line'),
	cueStepInk: cssVar('--cue-step-ink'),
	cueMotionBg: cssVar('--cue-motion-bg'),
	cueMotionLine: cssVar('--cue-motion-line'),
	cueMotionInk: cssVar('--cue-motion-ink'),
	phaseLine: () => rule(cueLine, '.phase', 'border').split(/\s+/).at(-1)!,
	margin: fieldRule('.margin', 'fill'),
	marginLine: fieldRule('.margin', 'stroke'),
	mat: fieldRule('.mat', 'fill'),
	matLine: fieldRule('.mat', 'stroke'),
	matGrid: fieldRule('.grid', 'stroke'),
	seam: fieldRule('.seam', 'stroke'),
	center: fieldRule('.center', 'stroke'),
	dotBase: fieldRule('.dot .base', 'fill'),
	dotTop: fieldRule('.dot .top', 'fill'),
	dotLine: fieldRule('.dot :is(circle, rect)', 'stroke'),
	dotInk: fieldRule('.dot text', 'fill'),
	dotTopInk: fieldRule('.dot .top + text', 'fill'),
	raised: fieldRule('.dot.raised :is(circle, rect)', 'stroke'),
	lv3: fieldRule('.dot.lv3 > g > :is(circle, rect):not(.ring):not(.focus-ring)', 'stroke'),
	covered: fieldRule('.covered', 'stroke'),
	front: fieldRule('.front', 'fill')
};

describe('VIDEO_COLORS 跟編輯器的 CSS 一樣', () => {
	it('每個 key 都有對照的原始碼', () => {
		expect(Object.keys(SOURCES).toSorted()).toEqual(Object.keys(VIDEO_COLORS).toSorted());
	});

	it.each(Object.keys(SOURCES) as ColorKey[])('%s', (key) => {
		expect(VIDEO_COLORS[key].toLowerCase()).toBe(SOURCES[key]().toLowerCase());
	});
});
