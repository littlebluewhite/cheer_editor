// 元件測試的 setup：Svelte 開發版的執行期警告（例：binding_property_non_reactive、derived_inert）
// 算測試失敗。Vitest 的 onConsoleLog 只能把輸出藏起來，不能讓測試失敗，所以自己包住 console.warn。
// 不在 console.warn 裡直接 throw：警告常在 effect 裡發，throw 會被 Svelte 吃掉或弄亂畫面；
// 改成記下來，每個測試結束時再算失敗。
import { afterEach } from 'vitest';

const warnings: string[] = [];
const original = console.warn.bind(console);

console.warn = (...args: unknown[]) => {
	const text = args.map(String).join(' ');
	if (text.includes('[svelte]') || text.includes('https://svelte.dev/e/')) warnings.push(text);
	original(...args);
};

afterEach(() => {
	if (warnings.length === 0) return;
	const found = warnings.splice(0);
	throw new Error(`Svelte 執行期警告（要修掉，不能留）：\n${found.join('\n')}`);
});
