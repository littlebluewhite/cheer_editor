// 真瀏覽器版面檢查：npm run check:layout
// 只放 jsdom 量不到的東西（點擊命中、溢出、捲動、媒體查詢、列印樣式），其他的放整頁測試或流程核心的測試（ADR 0002）。
// 跟重拍使用說明截圖（scripts/guide-screenshots.mjs）一樣：自己開 vite dev 和 headless Chrome，用 CDP 操作。
// 全部通過時 0 結束；有一條失敗就印出檢查名稱和量到的值，1 結束。
// Chrome 不在 macOS 預設位置時，用 CHROME=/path/to/chrome 指定。
// 同時有別的檢查在跑、埠被佔走時，用 LAYOUT_PORT=（vite，預設 4199）、LAYOUT_CDP=（Chrome，預設 9339）換別的埠。
//
// 怎麼加一條新檢查：
//   在最下面「檢查」那一段加
//     await check('名稱：預期什麼', async () => {
//       // 做某件事：setViewport、openSample、click、wheel，或 js(`...`) 在頁面裡跑
//       // 量一個東西：用 js(`return ...`) 拿回真的版面數字（getBoundingClientRect、elementFromPoint…）
//       return { ok: 有沒有過, value: 量到的值 };   // value 失敗時會印出來，寫得讓人看得懂
//     });
//   先在修之前跑一次，確定它會失敗，再去修。
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.LAYOUT_PORT ?? 4199);
const CDP = Number(process.env.LAYOUT_CDP ?? 9339);
const SAMPLE = resolve('docs/samples/sample-flow.zip');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'check-layout-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node_modules/.bin/vite', ['dev', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const chrome = spawn(CHROME, [
	'--headless=new', `--remote-debugging-port=${CDP}`, '--hide-scrollbars', '--mute-audio',
	`--user-data-dir=${join(tmp, 'profile')}`, 'about:blank'
]);
const stop = (code) => { chrome.kill(); server.kill(); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); stop(1); });
process.on('unhandledRejection', (e) => { console.error(e); stop(1); });

async function waitFor(fn) {
	for (let i = 0; i < 150; i++) {
		try { const v = await fn(); if (v) return v; } catch {}
		await sleep(200);
	}
	throw new Error('等太久');
}
await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok);
const targets = await waitFor(async () => {
	const t = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
	return t.some((x) => x.type === 'page') && t;
});

// ---------- CDP ----------
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
	// 上一條檢查留下未存的修改：換頁時的「離開網站？」直接按離開，不然頁面卡住
	if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
const send = (method, params = {}) =>
	new Promise((r, j) => {
		const i = ++id;
		pending.set(i, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result)));
		ws.send(JSON.stringify({ id: i, method, params }));
	});
const js = async (expr) => {
	const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)} → ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
	return r.result.value;
};
const mouse = (type, x, y, buttons = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
/** 真的滑鼠點一下（會被蓋在上面的東西擋住，跟人點一樣）。 */
const click = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0); await sleep(200); };
/** 真的滾輪（overflow: hidden 的東西滾不動，跟人滾一樣）。 */
const wheel = async (x, y, deltaY) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); await sleep(200); };
const setViewport = async (width, height) => {
	await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
	await sleep(400);
};

/** 開首頁，用「開啟流程檔」打開 docs/samples/sample-flow.zip，等編輯畫面出來。 */
async function openSample() {
	await send('Page.navigate', { url: `http://localhost:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	await waitFor(async () => {
		const input = await send('Runtime.evaluate', { expression: `document.querySelector('.home-open input[type=file]')` });
		if (input.result.objectId) await send('DOM.setFileInputFiles', { files: [SAMPLE], objectId: input.result.objectId });
		await sleep(500);
		return js(`return !!document.querySelector('.rail')`);
	});
	await sleep(300);
}

/**
 * 開首頁，打開一份有可以記成功率的動作的流程（範例流程沒有）：
 * 在頁面裡用測試共用的 libSample()（src/lib/test-flows.ts）做好、寫成流程檔，從「開啟流程檔」放進去。
 */
async function openPracticeFlow() {
	await send('Page.navigate', { url: `http://localhost:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	await js(`const { libSample } = await import('/src/lib/test-flows.ts');
		const { writeFlowFile } = await import('/src/lib/core/index.ts');
		const input = document.querySelector('.home-open input[type=file]');
		const dt = new DataTransfer();
		dt.items.add(new File([writeFlowFile(libSample(), {})], '練習用.zip', { type: 'application/zip' }));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));`);
	await waitFor(() => js(`return !!document.querySelector('.rail')`));
	await sleep(300);
}

/** 頁面裡元素的中心和外框。 */
const rectOf = (selector) =>
	js(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right };`);

const failed = [];
async function check(name, fn) {
	let res;
	try { res = await fn(); } catch (e) { res = { ok: false, value: String(e.message ?? e) }; }
	console.log(`${res.ok ? '通過' : '失敗'}  ${name}`);
	if (!res.ok) {
		console.log(`      量到：${typeof res.value === 'string' ? res.value : JSON.stringify(res.value)}`);
		failed.push(name);
	}
}

// ---------- 檢查 ----------
await send('Page.enable');
await send('DOM.enable');
await setViewport(1440, 1000);
await openSample();

const zoomText = () => js(`return document.querySelector('.rail .zoom').textContent.trim()`);
/** 按鈕中心點最上面的東西是不是按鈕自己；是的話用真的滑鼠點它。 */
async function hitAndClick(selector) {
	const p = await rectOf(selector);
	const hit = await js(`const el = document.elementFromPoint(${p.x}, ${p.y});
		const b = document.querySelector(${JSON.stringify(selector)});
		return { self: !!el && b.contains(el), top: el ? el.outerHTML.slice(0, 80) : null };`);
	if (hit.self) await click(p.x, p.y);
	return hit;
}

await check('場地的放大、縮小、全場按鈕點得到，點了倍率會變', async () => {
	const seen = {};
	const before = await zoomText();
	seen.放大 = { ...(await hitAndClick('.rail button[aria-label="放大"]')), 倍率: `${before} → ${await zoomText()}` };
	const mid = await zoomText();
	seen.全場 = { ...(await hitAndClick('.rail .tools button:not([aria-label])')), 倍率: `${mid} → ${await zoomText()}` };
	const after = await zoomText();
	seen.縮小 = { ...(await hitAndClick('.rail button[aria-label="縮小"]')) };
	await hitAndClick('.rail button[aria-label="放大"]');
	await hitAndClick('.rail button[aria-label="放大"]');
	const two = await zoomText();
	await hitAndClick('.rail button[aria-label="縮小"]');
	seen.縮小.倍率 = `${two} → ${await zoomText()}`;
	const ok =
		seen.放大.self && seen.全場.self && seen.縮小.self &&
		before === '×1.0' && mid !== before && after === '×1.0' && (await zoomText()) !== two;
	return { ok, value: seen };
});

await check('影子圓點不擋滑鼠', async () => {
	// 點第 2 張站位的小圖，播放頭停在站位 2，場上畫出站位 1 的影子
	await js(`[...document.querySelectorAll('.row.film .pick')][1].click()`);
	await sleep(300);
	const pe = await js(`const g = document.querySelector('[data-ghost]');
		return g ? getComputedStyle(g).pointerEvents : '場上沒有影子圓點';`);
	return { ok: pe === 'none', value: `pointer-events: ${pe}` };
});

/**
 * 用滾輪把場地左欄滾到底，量最下面的東西（圖例）有沒有整個在左欄和畫面裡，
 * 最下面那個點得到的工具（「只看橘紅走位線」）中心點是不是它自己。圖例本身不吃滑鼠，所以只量位置。
 */
async function railBottomVisible() {
	const rail = await rectOf('.rail');
	await wheel(rail.x, rail.y, 2000);
	return js(`
		const rail = document.querySelector('.rail').getBoundingClientRect();
		const r = document.querySelector('.rail > :last-child').getBoundingClientRect();
		const tool = document.querySelector('.rail .walk-tools label');
		const p = tool.getBoundingClientRect();
		const top = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2);
		const ok = r.bottom <= Math.min(rail.bottom, innerHeight) + 1 && r.top >= rail.top - 1 && !!top && tool.contains(top);
		return { ok, value: { 圖例: [Math.round(r.top), Math.round(r.bottom)], 左欄: [Math.round(rail.top), Math.round(rail.bottom)], 畫面高: innerHeight, 只看橘紅走位線中心點上面是: top ? top.outerHTML.slice(0, 80) : null } };`);
}

for (const [w, h] of [[1024, 768], [1280, 720]]) {
	await check(`${w}×${h} 開範例流程，場地左欄最下面的工具捲得到、看得到`, async () => {
		await setViewport(w, h);
		await openSample();
		return railBottomVisible();
	});
}

await check('時間軸拖到最大時，場地左欄最下面的工具捲得到、看得到', async () => {
	await setViewport(1440, 1000);
	await openSample();
	await js(`const s = document.querySelector('[aria-label="場地和時間軸的分界"]');
		for (let i = 0; i < 40; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));`);
	await sleep(300);
	const res = await railBottomVisible();
	// 拖過的高度存在這台電腦，下一條檢查不要受影響
	await js(`document.querySelector('[aria-label="場地和時間軸的分界"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
	return res;
});

/** 元素的四個角（往內縮 6px，避開圓角）最上面的東西是不是它自己：被裁掉或被蓋住的角會是別的東西。 */
const cornersVisible = (selector) =>
	js(`const el = document.querySelector(${JSON.stringify(selector)});
		const r = el.getBoundingClientRect();
		const pts = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6]];
		const bad = pts.filter(([x, y]) => { const t = document.elementFromPoint(x, y); return !t || !el.contains(t); })
			.map(([x, y]) => { const t = document.elementFromPoint(x, y); return [Math.round(x), Math.round(y), t ? t.outerHTML.slice(0, 60) : '畫面外']; });
		return { ok: bad.length === 0, value: { 小窗: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], 畫面: [innerWidth, innerHeight], 被擋住的角: bad } };`);

/** 開範例流程，在泳道上點第一個動作，右邊欄出現動作表單。 */
async function pickFirstAction(w, h) {
	await setViewport(w, h);
	await openSample();
	await js(`document.querySelector('[data-action-id]').click()`);
	await waitFor(() => js(`return !!document.querySelector('.action-form .bang')`));
	await sleep(200);
}

/** 把 selector 捲到右邊欄看得到的範圍裡、從上面算 k（0～1）的地方。 */
const scrollPanelTo = (selector, k) =>
	js(`const el = document.querySelector(${JSON.stringify(selector)}); const panel = el.closest('.panel');
		const top = panel.getBoundingClientRect().top;
		panel.scrollTop += el.getBoundingClientRect().top - (top + panel.clientHeight * ${k});
		await new Promise((r) => setTimeout(r, 150));
		return Math.round((el.getBoundingClientRect().top - top) / panel.clientHeight * 100) / 100;`);

await check('1400×900「!」說明小窗整個看得到，不被右邊欄裁掉', async () => {
	await pickFirstAction(1400, 900);
	// 「!」捲到右邊欄的各個高度（越下面，小窗往下開越容易被裁掉），每個都要整個看得到
	const bad = [];
	for (const k of [0.3, 0.5, 0.7, 0.85, 0.95]) {
		await js(`const b = document.querySelector('.action-form .bang'); if (b.getAttribute('aria-expanded') === 'true') b.click();`);
		const at = await scrollPanelTo('.action-form .bang', k);
		const p = await rectOf('.action-form .bang');
		await click(p.x, p.y);
		const res = await cornersVisible('#people-legend');
		if (!res.ok) bad.push({ 驚嘆號在右邊欄的: at, ...res.value });
	}
	return { ok: bad.length === 0, value: bad };
});

await check('拍點格子在畫面中間時，點一拍再 Shift 點下一拍，拍點小窗開在上面也不被分頁列、上方列蓋住', async () => {
	await pickFirstAction(1440, 900);
	// 範例的第一個動作不一定從 1-1 開始：用格子第一排裡最前面兩個能點的拍（報告裡是 1-6、1-7）
	const [first, next] = await js(`const cells = [...document.querySelector('.cues .row').querySelectorAll('.cell:not(:disabled)')];
		return [cells[0].getAttribute('aria-label'), cells[1].getAttribute('aria-label')];`);
	const cell = (n) => `.cues .cell[aria-label="${n}"]`;
	// 那一排捲到右邊欄的各個高度：下面放不下時小窗開在上面，開在上面的每一次都要整個看得到、down、up、✕ 點得到
	const bad = [];
	let aboveCount = 0;
	for (const k of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
		await js(`if (document.querySelector('.cues .pop')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
		const at = await scrollPanelTo(cell(first), k);
		const a = await rectOf(cell(first));
		await click(a.x, a.y);
		const b = await rectOf(cell(next));
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
		await sleep(300);
		const above = await js(`return document.querySelector('.cues .pop').classList.contains('above')`);
		if (!above) continue;
		aboveCount++;
		const res = await cornersVisible('.cues .pop');
		const btns = await js(`const pop = document.querySelector('.cues .pop');
			const els = [...pop.querySelectorAll('button')].filter((b) => ['down', 'up', '✕'].includes(b.textContent.trim()));
			return els.map((b) => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				return [b.textContent.trim(), !!t && b.contains(t)]; });`);
		if (!res.ok || btns.length !== 3 || !btns.every(([, v]) => v)) bad.push({ 那一排在右邊欄的: at, ...res.value, 按鈕: btns });
	}
	return { ok: aboveCount > 0 && bad.length === 0, value: { 選: `${first} 到 ${next}`, 開在上面幾次: aboveCount, 沒過: bad } };
});

// ---------- 窄螢幕（寬不到 1024 或高不到 600，ADR 0005 的 2026-11 更新） ----------

/** 觸控螢幕（手機、iPad）：pointer: coarse，點下去是手指。 */
async function setTouchViewport(width, height) {
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
	await sleep(400);
}
async function clearTouch() {
	await send('Emulation.setTouchEmulationEnabled', { enabled: false });
}
/** 手指點一下。 */
const tap = async (x, y) => {
	await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await sleep(300);
};
/** 頁面有沒有橫向捲軸、有沒有東西跑出畫面右邊（看得到的元素）。 */
const overflow = () =>
	js(`const out = [...document.querySelectorAll('body *')].filter((el) => {
			const r = el.getBoundingClientRect();
			return r.width && r.height && el.checkVisibility() && (r.right > innerWidth + 1 || r.left < -1);
		}).map((el) => el.outerHTML.slice(0, 60));
		return { 頁寬: document.scrollingElement.scrollWidth, 畫面寬: innerWidth, 跑出去的: out.slice(0, 5) };`);
const noOverflow = (o) => o.頁寬 <= o.畫面寬 && o.跑出去的.length === 0;
/** 擋住編輯畫面的提示看得到，按鈕整顆在畫面裡、中心點是它自己。 */
const narrowHint = () =>
	js(`const hint = document.querySelector('.narrow-hint');
		if (!hint || getComputedStyle(hint).display === 'none') return { ok: false, value: '沒有窄螢幕提示' };
		const buttons = [...hint.querySelectorAll('button')].map((b) => {
			const r = b.getBoundingClientRect();
			const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { 名字: b.textContent.trim(), 點得到: !!top && b.contains(top), 在畫面裡: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
		});
		const field = document.querySelector('.field-host').getBoundingClientRect();
		const cover = document.elementFromPoint(field.left + field.width / 2, field.top + field.height / 2);
		const covered = !!cover && hint.contains(cover);
		return { ok: covered && buttons.length === 2 && buttons.every((b) => b.點得到 && b.在畫面裡), value: { 場地被蓋住: covered, buttons } };`);

await check('768×1024 的桌面視窗算窄：編輯畫面顯示窄螢幕提示，不是一個很小的場地', async () => {
	await setViewport(768, 1024);
	await openSample();
	return narrowHint();
});

for (const [w, h] of [[390, 844], [820, 1180]]) {
	await check(`${w}×${h}（觸控）：開檔後被擋住，按「去練習」能記一次，不溢出`, async () => {
		await setTouchViewport(w, h);
		await openPracticeFlow();
		const hint = await narrowHint();
		if (!hint.ok) return hint;
		const go = await js(`const b = [...document.querySelectorAll('.narrow-hint button')].find((b) => b.textContent.trim() === '去練習');
			const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
		await tap(go.x, go.y);
		const inPractice = await js(`return !!document.querySelector('.practice-host') && !document.querySelector('.narrow-hint')`);
		if (!inPractice) return { ok: false, value: '按了「去練習」沒有進練習' };
		// 左邊清單挑第一個有卡的動作，第一張卡的第一個環節點「失敗」：點了 ✗ 就存成一次
		const picked = await js(`for (const b of document.querySelectorAll('.record .list button')) {
				b.click();
				await new Promise((r) => setTimeout(r, 100));
				if (document.querySelector('.card button[aria-label$="失敗"]')) return true;
			}
			return false;`);
		if (!picked) return { ok: false, value: '範例流程沒有可以記的動作' };
		const before = await js(`return document.querySelectorAll('.card .day li').length`);
		const mark = await js(`const b = document.querySelector('.card button[aria-label$="失敗"]');
			b.scrollIntoView({ block: 'center' });
			const r = b.getBoundingClientRect();
			const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { x: r.left + r.width / 2, y: r.top + r.height / 2, self: !!top && b.contains(top), top: top ? top.outerHTML.slice(0, 60) : null };`);
		if (!mark.self) return { ok: false, value: { 記號按鈕被蓋住: mark.top } };
		await tap(mark.x, mark.y);
		const after = await js(`return document.querySelectorAll('.card .day li').length`);
		const o = await overflow();
		return { ok: after === before + 1 && noOverflow(o), value: { 記了幾次: `${before} → ${after}`, ...o } };
	});
}

await check('844×390（手機橫拿）：提示和練習畫面都不溢出、按鈕點得到', async () => {
	await setTouchViewport(844, 390);
	await openSample();
	const hint = await narrowHint();
	const edit = await overflow();
	await js(`[...document.querySelectorAll('.narrow-hint button')].find((b) => b.textContent.trim() === '去練習').click()`);
	await sleep(300);
	const practice = await overflow();
	return { ok: hint.ok && noOverflow(edit) && noOverflow(practice), value: { 提示: hint.value, 編排: edit, 練習: practice } };
});
await clearTouch();

console.log(failed.length ? `\n${failed.length} 條沒過` : '\n全部通過');
stop(failed.length ? 1 : 0);
