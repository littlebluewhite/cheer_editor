// 這個分頁的語言（ADR 0017）。存的語言是每個分頁共用的：別的分頁換了語言，這個分頁不跟著變一半，
// 換語言時 Paraglide 也看得出這頁要重新載入。
import { getLocale, overwriteGetLocale, type Locale } from '#lib/paraglide/runtime.js';

const resolve = getLocale; // Paraglide 本來的挑法（存的 → 瀏覽器語言 → 中文）
let shown: Locale | undefined;

/** 從此這個分頁的 getLocale() 都是第一次挑到的語言（src/hooks.client.ts 一開始就呼叫）。 */
export function holdTabLocale() {
	overwriteGetLocale(() => (shown ??= resolve()));
}
