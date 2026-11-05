// App 圖示：瀏覽器分頁、主畫面、PWA 安裝看到的就是 static/ 底下這幾個檔，
// 由 app.html 的 <link> 和 vite.config.ts 的 manifest 指過去。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const html = read('src/app.html').toString();

/** PNG 檔頭（IHDR）裡的寬高。 */
function pngSize(path: string): string {
	const bytes = read(path);
	expect(bytes.subarray(1, 4).toString()).toBe('PNG');
	return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('App 圖示', () => {
	it('頁面指到 favicon，瀏覽器不會去找不存在的 /favicon.ico', () => {
		expect(html).toContain('<link rel="icon" href="%sveltekit.assets%/favicon.svg" type="image/svg+xml" />');
		expect(html).toContain('<link rel="icon" href="%sveltekit.assets%/favicon.ico" sizes="48x48" />');
		expect(existsSync(new URL('static/favicon.svg', root))).toBe(true);
		expect(read('static/favicon.ico').readUInt16LE(2)).toBe(1); // ICO 檔頭：type 1 = icon
	});

	it('iPhone、iPad 加到主畫面用 180×180 的 apple-touch-icon', () => {
		expect(html).toContain('<link rel="apple-touch-icon" href="%sveltekit.assets%/apple-touch-icon.png" />');
		expect(pngSize('static/apple-touch-icon.png')).toBe('180x180');
	});

	it('PWA manifest 有 192 和 512 的圖示，也有給 Android 裁成圓形的 maskable', () => {
		const config = read('vite.config.ts').toString();
		const icons = [...config.matchAll(/src: '([^']+)', sizes: '([^']+)'(?:, type: '[^']+')?(?:, purpose: '([^']+)')?/g)];
		const sizes = icons.map(([, src, size]) => {
			expect(pngSize(`static/${src}`)).toBe(size);
			return size;
		});
		expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
		expect(icons.some(([, , , purpose]) => purpose === 'maskable')).toBe(true);
	});
});
