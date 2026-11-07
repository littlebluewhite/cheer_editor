// 真瀏覽器版面檢查：npm run check:layout
// 只放 jsdom 量不到的東西（點擊命中、溢出、捲動、媒體查詢、列印樣式），其他的放整頁測試或流程核心的測試（ADR 0002）。
// 跟重拍使用說明截圖（scripts/guide-screenshots.mjs）一樣：自己開 vite dev 和 headless Chrome，用 CDP 操作。
// 全部通過時 0 結束；有一條失敗就印出檢查名稱和量到的值，1 結束。
// Chrome 不在 macOS 預設位置時，用 CHROME=/path/to/chrome 指定。
// vite 和 Chrome 的埠每次自己找空的，好幾個一起跑也不會撞；要固定的話用 LAYOUT_PORT=（vite）、LAYOUT_CDP=（Chrome）。
//
// 怎麼加一條新檢查：
//   在最下面「檢查」那一段加
//     await check('名稱：預期什麼', async () => {
//       // 做某件事：setViewport、openSample、click、wheel，或 js(`...`) 在頁面裡跑
//       // 量一個東西：用 js(`return ...`) 拿回真的版面數字（getBoundingClientRect、elementFromPoint…）
//       return { ok: 有沒有過, value: 量到的值 };   // value 失敗時會印出來，寫得讓人看得懂
//     });
//   先在修之前跑一次，確定它會失敗，再去修。
//
// 共用規則：整個腳本跑完，中間頁面只要丟過例外（沒接住的錯誤、沒處理的 rejection）就算失敗，
// 印出例外和是哪一條檢查時發生的（單元測試抓不到的那一類，例：拆元件途中失去焦點改到狀態）。
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** 跟作業系統要一個現在沒人用的埠（好幾個 agent 同時跑也不會撞到別人的 vite 或 Chrome）。 */
function freePort() {
	return new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
}
const PORT = Number(process.env.LAYOUT_PORT ?? (await freePort()));
const CDP = Number(process.env.LAYOUT_CDP ?? (await freePort()));
const SAMPLE = resolve('docs/samples/sample-flow.zip');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'check-layout-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node_modules/.bin/vite', ['dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
// vite 一開始就停掉（埠被佔、設定壞掉）時馬上說為什麼，不要傻等到「等太久」。
// 要等 vite 自己印出 Local: 網址才算開好：埠被別人佔著時，別人也會回 200，光看網頁打不打得開會騙人。
let viteErr = '';
let viteReady = false;
let started = false;
server.stdout.on('data', (d) => { if (String(d).replace(/\x1b\[[0-9;]*m/g, '').includes(`127.0.0.1:${PORT}/`)) viteReady = true; });
server.stderr.on('data', (d) => { viteErr += d; });
server.on('exit', (code) => { if (!started) { console.error(`vite 沒開起來（結束碼 ${code}）：\n${viteErr}`); stop(1); } });
const chrome = spawn(CHROME, [
	'--headless=new', `--remote-debugging-port=${CDP}`, '--hide-scrollbars', '--mute-audio',
	`--user-data-dir=${join(tmp, 'profile')}`, 'about:blank'
]);
const stop = (code) => { chrome.kill(); server.kill(); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); stop(1); });
process.on('unhandledRejection', (e) => { console.error(e); stop(1); });

async function waitFor(fn, tries = 150) {
	for (let i = 0; i < tries; i++) {
		try { const v = await fn(); if (v) return v; } catch {}
		await sleep(200);
	}
	throw new Error('等太久');
}
// 第一次開 vite 要先整理套件，很多東西同時在跑時會慢，所以這裡等久一點（最多 3 分鐘）
await waitFor(() => viteReady, 900);
await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) })).ok, 900);
started = true;
const targets = await waitFor(async () => {
	const t = await (await fetch(`http://127.0.0.1:${CDP}/json`, { signal: AbortSignal.timeout(2000) })).json();
	return t.some((x) => x.type === 'page') && t;
}, 900);

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
	if (m.method === 'Runtime.exceptionThrown') {
		const d = m.params.exceptionDetails;
		pageErrors.push({ check: current, error: (d.exception?.description ?? d.text).split('\n').slice(0, 4).join('\n') });
	}
});
/** 頁面丟過的例外，和那時在跑哪一條檢查。 */
const pageErrors = [];
let current = '（還沒開始檢查）';
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
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	await waitFor(async () => {
		// 先清空：頁面還沒接好事件時放的檔沒人收，同一個檔再放一次不會再觸發 change（機器忙時會一直「等太久」）
		const input = await send('Runtime.evaluate', { expression: `(() => { const i = document.querySelector('.home-open input[type=file]'); if (i) i.value = ''; return i; })()` });
		if (input.result.objectId) await send('DOM.setFileInputFiles', { files: [SAMPLE], objectId: input.result.objectId });
		await sleep(500);
		// 上一條檢查留下沒存的草稿：開同一個檔會先問「救回修改／用檔案」，按用檔案
		await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('用檔案'))?.click()`);
		await sleep(300);
		return js(`return !!document.querySelector('.rail, .phone-view')`);
	});
	await sleep(300);
}

/**
 * 開首頁，打開一份有可以記成功率的動作的流程（範例流程沒有）：
 * 在頁面裡用測試共用的 libSample()（src/lib/test-flows.ts）做好、寫成流程檔，從「開啟流程檔」放進去。
 * more 是在頁面裡改 flow 的程式（可以用 core 裡的函式），例如加拍點。
 */
async function openPracticeFlow(more = '') {
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	await js(`const { libSample } = await import('/src/lib/test-flows.ts');
		const core = await import('/src/lib/core/index.ts');
		const { writeFlowFile } = core;
		let flow = libSample();
		${more}
		const input = document.querySelector('.home-open input[type=file]');
		const dt = new DataTransfer();
		dt.items.add(new File([writeFlowFile(flow, {})], '練習用.zip', { type: 'application/zip' }));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));`);
	await waitFor(() => js(`return !!document.querySelector('.rail, .phone-view')`));
	await sleep(300);
}

/**
 * 開首頁，打開一份 40 人的流程：音樂 1（4 個八拍），x1 全隊跳躍（環節「整個」整個動作，可以記全上），
 * 上面一個很長的步驟拍點（量八拍表印出來有沒有被截斷）。
 * more 是在頁面裡改 flow 的程式（c 是 core、of 拿出成功的流程），例如加站位。
 */
async function openBigFlow(more = '') {
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	await js(`const c = await import('/src/lib/core/index.ts');
		const of = (r) => { if (r.kind !== 'ok') throw new Error(JSON.stringify(r)); return r.flow; };
		let flow = of(c.createFlow({ name: '40 人', field: { strips: 9, layout: 'vertical' } }));
		flow = of(c.addMembers(flow, Array.from({ length: 40 }, (_, i) => ({ name: '隊員' + (i + 1), gender: 'F', globalRole: 'base' }))));
		flow = of(c.addSegment(flow, 'music'));
		flow = of(c.updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
		flow = of(c.addAction(flow, { segmentId: 's1', category: 'jump', name: '跳', start: 0, length: 16, note: '',
			members: flow.members.map((m) => ({ memberId: m.id, role: null })) }));
		flow = of(c.addPhase(flow, 'x1', { kind: 'whole', name: '整個跳', beats: { at: 0, len: 16 } }));
		flow = of(c.placeCue(flow, 'x1', { kind: 'step', at: 0, len: 2, word: '左腳往前踩一步然後手臂拉到高V再往下收回胸前' }));
		${more}
		const input = document.querySelector('.home-open input[type=file]');
		const dt = new DataTransfer();
		dt.items.add(new File([c.writeFlowFile(flow, {})], '40人.zip', { type: 'application/zip' }));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));`);
	await waitFor(() => js(`return !!document.querySelector('.topbar')`));
	await sleep(300);
}

/** 頁面裡元素的中心和外框。 */
const rectOf = (selector) =>
	js(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right };`);

const failed = [];
async function check(name, fn) {
	current = name;
	let res;
	try { res = await fn(); } catch (e) { res = { ok: false, value: String(e.message ?? e) }; }
	console.log(`${res.ok ? '通過' : '失敗'}  ${name}`);
	if (!res.ok) {
		console.log(`      量到：${typeof res.value === 'string' ? res.value : JSON.stringify(res.value)}`);
		failed.push(name);
	}
	current = `（「${name}」之後、下一條檢查之前）`;
}

// ---------- 檢查 ----------
await send('Page.enable');
await send('DOM.enable');
await send('Runtime.enable');
await setViewport(1440, 1000);
await openSample();

/** 真的按一個鍵（送到有焦點的地方，跟人按一樣）：Enter、Escape、Tab、End、Home。 */
async function press(key) {
	const code = { Enter: 13, Escape: 27, Tab: 9, End: 35, Home: 36 }[key];
	for (const type of ['keyDown', 'keyUp'])
		await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
	await sleep(300);
}

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

await check('場地的放大、縮小、整個場地按鈕點得到，點了倍率會變', async () => {
	const seen = {};
	const before = await zoomText();
	seen.放大 = { ...(await hitAndClick('.rail button[aria-label="放大"]')), 倍率: `${before} → ${await zoomText()}` };
	const mid = await zoomText();
	seen.整個場地 = { ...(await hitAndClick('.rail .tools button:not([aria-label])')), 倍率: `${mid} → ${await zoomText()}` };
	const after = await zoomText();
	seen.縮小 = { ...(await hitAndClick('.rail button[aria-label="縮小"]')) };
	await hitAndClick('.rail button[aria-label="放大"]');
	await hitAndClick('.rail button[aria-label="放大"]');
	const two = await zoomText();
	await hitAndClick('.rail button[aria-label="縮小"]');
	seen.縮小.倍率 = `${two} → ${await zoomText()}`;
	const ok =
		seen.放大.self && seen.整個場地.self && seen.縮小.self &&
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

await check('1400×900「?」說明小窗整個看得到，不被右邊欄裁掉', async () => {
	await pickFirstAction(1400, 900);
	// 「!」捲到右邊欄的各個高度（越下面，小窗往下開越容易被裁掉），每個都要整個看得到
	const bad = [];
	for (const k of [0.3, 0.5, 0.7, 0.85, 0.95]) {
		await js(`const b = document.querySelector('.action-form .bang'); if (b.getAttribute('aria-expanded') === 'true') b.click();`);
		const at = await scrollPanelTo('.action-form .bang', k);
		const p = await rectOf('.action-form .bang');
		await click(p.x, p.y);
		const res = await cornersVisible('#people-legend');
		if (!res.ok) bad.push({ 問號在右邊欄的: at, ...res.value });
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

await check('總表點一格：右邊的明細不蓋住上方列，存檔點得到', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow();
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(200);
	await js(`[...document.querySelectorAll('.practice .pages button')].find((b) => b.textContent.trim() === '總表').click()`);
	await sleep(200);
	await js(`document.querySelector('.summary .cell').click()`);
	await sleep(400);
	return js(`const save = document.querySelector('.topbar .save');
		const r = save.getBoundingClientRect();
		const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		const d = document.querySelector('.detail').getBoundingClientRect();
		const bar = document.querySelector('.topbar').getBoundingClientRect();
		return { ok: !!top && save.contains(top) && d.top >= bar.bottom - 1,
			value: { 存檔中心點上面是: top ? top.outerHTML.slice(0, 60) : null, 明細上緣: Math.round(d.top), 上方列下緣: Math.round(bar.bottom) } };`);
});

for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768]]) {
	await check(`${w}×${h} 播放頭在有很多拍點的動作裡：大字卡整張看得到，下緣不被切`, async () => {
		await setViewport(w, h);
		// Lib 第 1 拍放拍子、步驟、手位，給全部、上層、小美各一個：卡又高又多行
		await openPracticeFlow(`for (const c of [
				{ kind: 'count', at: 0, len: 4, word: 'down' },
				{ kind: 'step', at: 0, len: 4, word: '下手' },
				{ kind: 'step', at: 0, len: 4, word: '上', who: { role: '上層' } },
				{ kind: 'motion', at: 0, len: 2, word: 'high V' },
				{ kind: 'motion', at: 0, len: 2, word: 'T', who: { member: 'm1' } },
				{ kind: 'motion', at: 2, len: 2, word: 'low V' }
			]) { const r = core.placeCue(flow, 'x1', c); if (r.kind !== 'ok') throw new Error(r.message); flow = r.flow; }`);
		const r = await rectOf('[data-ruler]');
		await click(r.left + 2, r.y);
		await sleep(300);
		return js(`const box = document.querySelector('.cues-now');
			if (!box) return { ok: false, value: '沒有大字卡' };
			const b = box.getBoundingClientRect();
			const cards = [...box.querySelectorAll('.card')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
			const cut = cards.filter(([, bottom]) => bottom > b.bottom + 0.5);
			return { ok: cards.length > 0 && cut.length === 0, value: { 大字區: [Math.round(b.top), Math.round(b.bottom)], 卡: cards, 下緣被切: cut } };`);
	});
}

for (const [w, h] of [[1440, 900], [1024, 768]]) {
	await check(`${w}×${h} 大字卡寫 9 個字的步驟、走到 1/2：字和「1/2」都整個看得到，不被切`, async () => {
		await setViewport(w, h);
		await openPracticeFlow(`flow = core.placeCue(flow, 'x1', { kind: 'step', at: 0, len: 4, word: '九個字的步驟名稱長' }).flow;`);
		const r = await rectOf('[data-ruler]');
		await click(r.left + 2, r.y);
		await sleep(300);
		return js(`const box = document.querySelector('.cues-now');
			if (!box) return { ok: false, value: '沒有大字卡' };
			const b = box.getBoundingClientRect();
			const step = box.querySelector('.now .step');
			if (!step) return { ok: false, value: '大字卡沒有步驟' };
			const s = step.getBoundingClientRect();
			const small = step.querySelector('small');
			const f = small ? small.getBoundingClientRect() : null;
			const inBox = (r) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
			const ok = !!f && small.textContent.trim() === '1/2' && step.textContent.includes('九個字的步驟名稱長')
				&& inBox(s) && inBox(f) && step.scrollWidth <= step.clientWidth + 1;
			return { ok, value: { 大字區: [Math.round(b.left), Math.round(b.right)], 步驟: [Math.round(s.left), Math.round(s.right)],
				'1/2': f && [Math.round(f.left), Math.round(f.right)], 步驟裡面寬: [step.scrollWidth, step.clientWidth] } };`);
	});
}

await check('1440×900 拍點小窗貼不下時：錯誤訊息在畫面裡、看得到（小窗開在格子各個高度都是）', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow(`flow = core.placeCue(flow, 'x1', { kind: 'step', at: 0, len: 4, word: '下手' }).flow;`);
	await js(`document.querySelector('[data-lane="m1"] [data-action-id="x1"]').click()`);
	await waitFor(() => js(`return !!document.querySelector('.cues .cell[aria-label="1-8"]')`));
	await sleep(200);
	const cell = (n) => `.cues .cell[aria-label="${n}"]`;
	// 複製 1-1 到 1-2（下手兩拍），貼在最後一拍 1-8：貼不下
	await scrollPanelTo(cell('1-1'), 0.3);
	const a = await rectOf(cell('1-1'));
	await click(a.x, a.y);
	const b = await rectOf(cell('1-2'));
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
	await sleep(300);
	await js(`document.querySelector('.cues .pop [aria-label="複製選的拍點"]').click()`);
	const bad = [];
	let seen = 0;
	for (const k of [0.2, 0.4, 0.6, 0.75, 0.9]) {
		await js(`if (document.querySelector('.cues .pop')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
		const at = await scrollPanelTo(cell('1-8'), k);
		const c = await rectOf(cell('1-8'));
		await click(c.x, c.y);
		const paste = await rectOf('.cues .pop [aria-label="貼上拍點"]');
		await click(paste.x, paste.y);
		const res = await js(`const err = document.querySelector('.cues .pop .error');
			if (!err) return { ok: false, value: '沒有錯誤訊息' };
			const r = err.getBoundingClientRect();
			const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { ok: r.top >= 0 && r.bottom <= innerHeight && !!t && err.contains(t),
				value: { 錯誤訊息: [Math.round(r.top), Math.round(r.bottom)], 畫面高: innerHeight, 中心點上面是: t ? t.outerHTML.slice(0, 60) : '畫面外' } };`);
		if (res.value !== '沒有錯誤訊息') seen++;
		if (!res.ok) bad.push({ 那一排在右邊欄的: at, ...(typeof res.value === 'string' ? { 量到: res.value } : res.value) });
	}
	return { ok: seen > 0 && bad.length === 0, value: { 有錯誤訊息幾次: seen, 沒過: bad } };
});

await check('1440×900 把右邊欄拖到最寬，換成 1024×768：場地本身還有 360 px 寬（右邊欄寬度照比例記）', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow();
	const bar = await rectOf('.col-split');
	await mouse('mousePressed', bar.x, bar.y);
	await mouse('mouseMoved', 0, bar.y);
	await mouse('mouseReleased', 0, bar.y, 0);
	await sleep(200);
	const fieldW = () => js(`return Math.round(document.querySelector('.field-host svg.field').getBoundingClientRect().width)`);
	const wide = await fieldW();
	await setViewport(1024, 768);
	const small = await fieldW();
	// 拖過的寬度記在這台電腦：清掉，後面的檢查從預設版面開始
	await js(`for (const k of Object.keys(localStorage)) if (k.startsWith('cheer-editor:inspectorWidth')) localStorage.removeItem(k)`);
	return { ok: wide >= 360 && small >= 360, value: { 拖完的場地寬: wide, '1024×768 的場地寬': small } };
});

await check('超寬螢幕（2560 寬）按「符合寬度」：整支流程放滿時間軸，沒有橫向捲軸', async () => {
	await setViewport(2560, 1200);
	await openSample();
	const hit = await hitAndClick('.timeline [aria-label="符合寬度"]');
	await sleep(200);
	const m = await js(`const t = document.querySelector('.timeline'); const trk = t.querySelector('.ruler');
		return { 看得到: t.clientWidth, 捲得到: t.scrollWidth, 流程: Math.round(trk.getBoundingClientRect().width) };`);
	return { ok: hit.self && m.捲得到 <= m.看得到 && m.流程 >= (m.看得到 - 148) * 0.9, value: { ...m, 擋住按鈕的: hit.self ? null : hit.top } };
});

await check('1440×900 最後一段旁的「＋」點得到，選單整個看得到、選項點得到', async () => {
	await setViewport(1440, 900);
	await openSample();
	// 時間軸捲到最右邊：最後一段的「＋」在看得到的範圍右邊
	await js(`const t = document.querySelector('.timeline'); t.scrollLeft = t.scrollWidth;`);
	await sleep(200);
	await js(`const all = document.querySelectorAll('.timeline .add-after'); all[all.length - 1].classList.add('last-add')`);
	const hit = await hitAndClick('.timeline .last-add');
	if (!hit.self) return { ok: false, value: { 擋住加段鈕的: hit.top } };
	const res = await cornersVisible('.menu');
	const btns = await js(`return [...document.querySelectorAll('.menu button')].map((b) => { const r = b.getBoundingClientRect();
		const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [b.textContent.trim(), !!t && b.contains(t)]; });`);
	return { ok: res.ok && btns.length === 2 && btns.every(([, v]) => v), value: { ...res.value, 選項: btns } };
});

await check('1024×768「段」那一格的「插入八拍」和「＋」都點得到；小窗整個看得到、欄位點得到（#168）', async () => {
	await setViewport(1024, 768);
	await openSample();
	const add = await js(`const b = document.querySelector('.timeline .segs .lab .add'); const r = b.getBoundingClientRect();
		const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && b.contains(t);`);
	const hit = await hitAndClick('.timeline .segs .lab .insert');
	if (!hit.self || !add) return { ok: false, value: { 加段鈕點得到: add, 擋住插入鈕的: hit.top } };
	await sleep(200);
	const res = await cornersVisible('.insert-pop');
	const parts = await js(`return [...document.querySelectorAll('.insert-pop input, .insert-pop select, .insert-pop button')].map((b) => { const r = b.getBoundingClientRect();
		const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [b.getAttribute('aria-label') || b.textContent.trim(), !!t && b.contains(t)]; });`);
	return { ok: res.ok && parts.length === 3 && parts.every(([, v]) => v), value: { ...res.value, 欄位: parts } };
});

// ---------- 上方列、首頁、場地編號（#110） ----------

/** 用流程設定把流程名字改成 name（關掉對話框）。 */
async function renameFlowTo(name) {
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.title === '流程設定').click()`);
	await waitFor(() => js(`return !!document.querySelector('.flow-dialog')`));
	await js(`const i = [...document.querySelectorAll('.flow-dialog label')].find((l) => l.textContent.includes('流程名字')).querySelector('input');
		i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event('change', { bubbles: true }));`);
	await sleep(100);
	await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await sleep(200);
}

for (const w of [1141, 1200, 1300, 1670, 1671, 1800, 1801]) {
	await check(`${w} 寬：長的流程名字至少看得到 8 個字，不被壓到四五個字`, async () => {
		await setViewport(w, 900);
		await openSample();
		await renameFlowTo('二〇二七全國賽決賽版本第三版');
		const r = await js(`const b = document.querySelector('.topbar .title b');
			return { 名字寬: Math.round(b.getBoundingClientRect().width), 一個字: parseFloat(getComputedStyle(b).fontSize) };`);
		return { ok: r.名字寬 >= 8 * r.一個字, value: r };
	});
}

await check('1400 寬：「八拍表」按鈕有字，不是只有圖示', async () => {
	await setViewport(1400, 900);
	await openSample();
	// 字有沒有真的畫出來：包著「八拍表」三個字的那一層夠寬（只給讀屏的字包在縮成 1px 的框裡）
	const r = await js(`const b = [...document.querySelectorAll('.topbar button')].find((x) => x.title === '八拍表');
		const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
		let node; while ((node = walker.nextNode()) && !node.textContent.includes('八拍表'));
		if (!node) return { 包著字的寬: 0 };
		return { 包著字的寬: Math.round(node.parentElement.getBoundingClientRect().width), 按鈕寬: Math.round(b.getBoundingClientRect().width) };`);
	return { ok: r.包著字的寬 >= 40, value: r };
});

for (const w of [1920, 1400]) {
	await check(`${w} 寬：按「檢視」再按回「編輯」，上方列的按鈕和播放區都不跑（復原、重做、流程設定只變灰）`, async () => {
		await setViewport(w, 900);
		await openSample();
		const where = `return [...document.querySelectorAll('.topbar button, .topbar .btn')].map((b) => Math.round(b.getBoundingClientRect().left)).join(',');`;
		const press = (name) => `[...document.querySelectorAll('.topbar .mode button')].find((b) => b.textContent.trim() === '${name}').click();`;
		const edit = await js(where);
		await js(press('檢視'));
		await sleep(100);
		const view = await js(where);
		await js(press('編輯'));
		return { ok: edit === view, value: { 編輯: edit, 檢視: view } };
	});
}

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]]) {
	await check(`${w}×${h} 按「檢視」：左邊的站位編輯欄藏起來，場地比編輯模式大；按回「編輯」場地回原來大小（#213）`, async () => {
		await setViewport(w, h);
		await openSample();
		const size = `const r = document.querySelector('.field-host .mat').getBoundingClientRect(); return { 寬: Math.round(r.width), 高: Math.round(r.height), 左欄: !!document.querySelector('.field-host .rail')?.offsetParent };`;
		const press = (name) => `[...document.querySelectorAll('.topbar .mode button')].find((b) => b.textContent.trim() === '${name}').click();`;
		const edit = await js(size);
		await js(press('檢視'));
		await sleep(300);
		const view = await js(size);
		await js(press('編輯'));
		await sleep(300);
		const back = await js(size);
		const ok = view.寬 > edit.寬 && view.高 > edit.高 && !view.左欄 && edit.左欄 && back.寬 === edit.寬 && back.高 === edit.高;
		return { ok, value: { 編輯: edit, 檢視: view, 切回編輯: back } };
	});
}

await check('1440 寬：播放頭到結尾（位置只寫「結尾」）時，上方列高度不變（#205）', async () => {
	await setViewport(1440, 900);
	await openSample();
	const measure = `return { 高: document.querySelector('.topbar').getBoundingClientRect().height, 位置: document.querySelector('[aria-label="目前位置"]').textContent };`;
	await js(`document.activeElement?.blur()`);
	await press('Home');
	const start = await js(measure);
	await press('End');
	const end = await js(measure);
	await press('Home');
	return { ok: end.位置 === '結尾' && end.高 === start.高, value: { 開頭: start, 結尾: end } };
});

await check('1440 寬：「使用說明」「設定」按鈕有字，不是只有圖示', async () => {
	await setViewport(1440, 900);
	await openSample();
	const r = await js(`const textW = (el, word) => {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			let node; while ((node = walker.nextNode()) && !node.textContent.includes(word));
			return node ? Math.round(node.parentElement.getBoundingClientRect().width) : 0; };
		const guide = document.querySelector('.topbar a[title="使用說明"]');
		const gear = [...document.querySelectorAll('.topbar button')].find((x) => x.title === '流程設定');
		return { 使用說明: textW(guide, '使用說明'), 設定: textW(gear, '設定') };`);
	return { ok: r.使用說明 >= 40 && r.設定 >= 20, value: r };
});

/** 上方列每顆看得到的按鈕、連結：中心點最上面的東西是不是它自己。 */
const topbarHits = () =>
	js(`return [...document.querySelectorAll('.topbar button, .topbar a, .topbar label.btn')].filter((el) => el.checkVisibility()).flatMap((el) => {
			const r = el.getBoundingClientRect();
			if (r.width < 3 || r.height < 3) return [];
			const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			const inView = r.left >= 0 && r.right <= innerWidth;
			return !!t && el.contains(t) && inView ? [] : [{ 按鈕: (el.title || el.textContent).trim().slice(0, 8), 點到: t ? t.outerHTML.slice(0, 60) : null, 在畫面裡: inView }];
		});`);
/**
 * 記錄頁一個一個選動作的程式（放在 js 裡用）：寬的時候點左邊清單，窄的時候（手機）從下拉選單選。
 * 用法：for (const pick of PICKS) { pick(); ... }
 */
const PICKS = `const select = document.querySelector('.record .pick select');
	const PICKS = select
		? [...select.options].map((o) => () => { select.value = o.value; select.dispatchEvent(new Event('change', { bubbles: true })); })
		: [...document.querySelectorAll('.record .list button')].map((b) => () => b.click());`;
/** 「編排｜練習」的位置。 */
const viewSpot = () => js(`const r = document.querySelector('.topbar .view').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)];`);
/** 在練習頁記一次（流程就有未存的修改）。 */
async function recordOnce() {
	return js(`${PICKS}
		for (const pick of PICKS) {
			pick();
			await new Promise((r) => setTimeout(r, 100));
			const fail = document.querySelector('.card button[aria-label$="失敗"]');
			if (fail) { fail.click(); await new Promise((r) => setTimeout(r, 100)); document.querySelector('.card .save').click(); await new Promise((r) => setTimeout(r, 200)); return true; }
		}
		return false;`);
}

for (const w of [390, 500, 760]) {
	await check(`${w} 寬練習頁：上方列每顆按鈕點到的是它自己（出現「未存」前後都是），流程名字看得到，「編排｜練習」不被推走`, async () => {
		await setViewport(w, 844);
		await openPracticeFlow();
		await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '練習').click()`);
		await sleep(300);
		const before = await topbarHits();
		const spot = await viewSpot();
		const recorded = await recordOnce();
		const unsaved = await js(`return !!document.querySelector('.topbar .unsaved')`);
		const after = await topbarHits();
		const spotAfter = await viewSpot();
		const nameW = await js(`return Math.round(document.querySelector('.topbar .title b').getBoundingClientRect().width)`);
		const v = { 未存前點錯的: before, 未存後點錯的: after, 有未存: recorded && unsaved, 編排練習: `${spot} → ${spotAfter}`, 名字寬: nameW };
		return { ok: before.length === 0 && after.length === 0 && v.有未存 && String(spot) === String(spotAfter) && nameW > 0, value: v };
	});
}

await check('1440 寬編排頁：出現「未存」前後，「編排｜練習」位置不變', async () => {
	await setViewport(1440, 900);
	await openSample();
	const spot = await viewSpot();
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.title === '流程設定').click()`);
	await waitFor(() => js(`return !!document.querySelector('.flow-dialog')`));
	await js(`document.querySelector('.flow-dialog input[type=checkbox]').click()`);
	await sleep(100);
	await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await sleep(200);
	const unsaved = await js(`return !!document.querySelector('.topbar .unsaved')`);
	const spotAfter = await viewSpot();
	return { ok: unsaved && String(spot) === String(spotAfter), value: { 有未存: unsaved, 編排練習: `${spot} → ${spotAfter}` } };
});

await check('首頁 761–900 寬：大標題「競技啦啦隊」「流程編輯器」各一行，不溢出', async () => {
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!document.querySelector('.intro h1')`));
	const bad = [];
	for (const w of [761, 800, 850, 900]) {
		await setViewport(w, 900);
		const r = await js(`const h = document.querySelector('.intro h1');
			const range = document.createRange(); range.selectNodeContents(h);
			const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
			return { 寬: ${w}, 行數: lines, 溢出: h.scrollWidth > h.clientWidth + 1 };`);
		if (r.行數 !== 2 || r.溢出) bad.push(r);
	}
	return { ok: bad.length === 0, value: bad };
});

await check('首頁有 5 支最近的流程（名字很長）：1440×900 照樣有（捲過去）點得到的「建立」和「開啟流程檔」；390×844 沒有「建立」，「開啟流程檔」整欄寬、在第一個畫面裡；「丟掉」離打開的按鈕遠一點，不溢出', async () => {
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte`));
	// 直接在 IndexedDB 放 5 份草稿（跟 src/lib/file/draft.ts 存的一樣），重新整理
	await js(`const c = await import('/src/lib/core/index.ts');
		const db = await new Promise((r, j) => { const q = indexedDB.open('cheer-editor', 1);
			q.onupgradeneeded = () => q.result.createObjectStore('draft'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
		const tx = db.transaction('draft', 'readwrite');
		tx.objectStore('draft').clear();
		for (let i = 0; i < 5; i++) {
			const flow = c.createFlow({ name: '第' + i + '支'.repeat(36), field: { strips: 9, layout: 'vertical' } }).flow;
			tx.objectStore('draft').put({ bytes: c.writeFlowFile(flow, {}), savedAt: Date.now() - i * 60000 }, 'layout-' + i);
		}
		await new Promise((r) => (tx.oncomplete = r));
		db.close();`);
	const bad = [];
	for (const [w, h] of [[1440, 900], [390, 844]]) {
		await setViewport(w, h);
		await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
		await waitFor(() => js(`return !!window.__svelte && document.querySelectorAll('.recent li').length === 5`), 30).catch(() => {});
		const r = await js(`const seen = (el) => { if (!el) return '沒有';
				el.scrollIntoView({ block: 'nearest' });
				const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
				return b.top >= 0 && b.bottom <= innerHeight && !!top && el.contains(top) ? '好' : '看不到或點不到'; };
			const create = [...document.querySelectorAll('.home button')].find((b) => b.textContent.trim() === '建立');
			const li = document.querySelector('.recent li');
			const gap = li ? li.querySelector('.recent-drop').getBoundingClientRect().left - li.querySelector('.recent-open').getBoundingClientRect().right : -1;
			const open = document.querySelector('.home-open label.open');
			const openBox = open.getBoundingClientRect();
			const column = document.querySelector('.start').getBoundingClientRect();
			// 窄的時候：開啟流程檔不用捲就看得到（先看位置，seen 會捲過去）、跟整欄一樣寬
			const openFirstScreen = openBox.bottom <= innerHeight;
			return { 寬: ${w}, 建立: create ? seen(create) : '沒有', 開啟流程檔: seen(open),
				開啟在第一個畫面: openFirstScreen, 開啟整欄寬: openBox.width >= column.width - 2,
				最近的流程: document.querySelectorAll('.recent li').length, 丟掉離打開: Math.round(gap),
				溢出: document.scrollingElement.scrollWidth > innerWidth ? [...document.querySelectorAll('.home *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map((el) => el.outerHTML.slice(0, 50)).slice(0, 4) : false };`);
		const narrowOk = w < 1024 ? r.建立 === '沒有' && r.開啟在第一個畫面 && r.開啟整欄寬 : r.建立 === '好';
		if (!narrowOk || r.開啟流程檔 !== '好' || r.最近的流程 !== 5 || r.丟掉離打開 < 12 || r.溢出) bad.push(r);
	}
	await js(`await new Promise((r) => { const q = indexedDB.deleteDatabase('cheer-editor'); q.onsuccess = q.onerror = q.onblocked = r; });`);
	return { ok: bad.length === 0, value: bad };
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
/**
 * 手機的檢視畫面（#175）：上面場地、中間播放鈕、下面八拍表這一列（橫拿時場地在左），都在畫面裡；
 * 播放鈕和「我」整顆在畫面裡、中心點是它自己；上方列每顆按鈕點到的是它自己；沒有「編輯｜檢視」切換。
 */
const phoneView = () =>
	js(`const view = document.querySelector('.phone-view');
		if (!view || !view.checkVisibility()) return { ok: false, value: '沒有手機的檢視畫面' };
		const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
		const hit = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return !!t && el.contains(t) && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
		const field = box(view.querySelector('.phone-field svg.field'));
		const play = view.querySelector('.transport .play');
		const row = box(view.querySelector('.now-eight'));
		const v = { 場地: field, 播放鈕點得到: hit(play), 我點得到: hit(view.querySelector('#me-pick')), 八拍表這一列: row,
			有編輯開關: !!document.querySelector('.topbar .mode'), 畫面高: innerHeight };
		// 直拿：場地在播放鈕上面；橫拿：場地在左邊
		const f = view.querySelector('.phone-field svg.field').getBoundingClientRect(), p = play.getBoundingClientRect();
		const inOrder = field.h >= 120 && (f.bottom <= p.top + 1 || f.right <= p.left + 1) && row.h > 0 && row.bottom <= innerHeight + 1;
		return { ok: inOrder && v.播放鈕點得到 && v.我點得到 && !v.有編輯開關, value: v };`);

/** 手機的檢視畫面最下面那行「為什麼不能編」的字（#164）；看不到是 null。 */
const viewOnlyWhy = () =>
	js(`const p = document.querySelector('.phone-view .phone-why');
		if (!p || !p.checkVisibility()) return null;
		const r = p.getBoundingClientRect();
		return r.bottom <= innerHeight + 1 && r.top >= 0 ? p.textContent.trim() : '（在畫面外）' + p.textContent.trim();`);

await check('768×1024（觸控，直拿的 iPad）：檢視畫面寫「請轉成橫的」，不寫太窄', async () => {
	await setTouchViewport(768, 1024);
	await openPracticeFlow();
	const why = await viewOnlyWhy();
	await clearTouch();
	return { ok: !!why && why.startsWith('請轉成橫的') && !why.includes('太窄'), value: why };
});

await check('1440×500（矮的桌面視窗）：檢視畫面寫「太矮」，不寫太窄', async () => {
	await setViewport(1440, 500);
	await openPracticeFlow();
	const why = await viewOnlyWhy();
	return { ok: !!why && why.includes('太矮') && !why.includes('太窄') && !why.startsWith('（'), value: why };
});

await check('768×1024 的桌面視窗算窄：編排是手機的檢視畫面，不是一個很小的場地', async () => {
	await setViewport(768, 1024);
	await openSample();
	return phoneView();
});

for (const [w, h] of [[320, 640], [390, 844]]) {
	// 手機的版面寬會跟著撐寬的內容變大（innerWidth 也跟著變），所以跟設定的螢幕寬比
	await check(`${w}×${h}（觸控）：手機的檢視畫面不把頁面撐寬（不能往右拖）`, async () => {
		await setTouchViewport(w, h);
		await openSample();
		const phone = await phoneView();
		if (!phone.ok) return phone;
		const v = await js(`return { 頁寬: document.scrollingElement.scrollWidth, 版面寬: innerWidth }`);
		return { ok: v.頁寬 <= w && v.版面寬 <= w, value: { 螢幕寬: w, ...v } };
	});
}

for (const [w, h] of [[390, 844], [820, 1180]]) {
	await check(`${w}×${h}（觸控）：開檔直接是檢視畫面（不溢出、播放鈕和上方列點得到）；切到「練習」能記一次，不溢出`, async () => {
		await setTouchViewport(w, h);
		await openPracticeFlow();
		const phone = await phoneView();
		const hits = await topbarHits();
		const o0 = await overflow();
		if (!phone.ok || hits.length || !noOverflow(o0)) return { ok: false, value: { 檢視畫面: phone.value, 上方列點錯的: hits, ...o0 } };
		const go = await js(`const b = [...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '練習');
			const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
		await tap(go.x, go.y);
		const inPractice = await js(`return !!document.querySelector('.practice-host') && !document.querySelector('.phone-view')`);
		if (!inPractice) return { ok: false, value: '按了「練習」沒有進練習' };
		// 左邊清單挑第一個有卡的動作，第一張卡的第一個環節點「失敗」，再按「存這一次」：存成一次
		const picked = await js(`${PICKS}
			for (const pick of PICKS) {
				pick();
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
		const save = await js(`const b = document.querySelector('.card .save');
			b.scrollIntoView({ block: 'center' });
			const r = b.getBoundingClientRect();
			const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { x: r.left + r.width / 2, y: r.top + r.height / 2, self: !!top && b.contains(top), top: top ? top.outerHTML.slice(0, 60) : null };`);
		if (!save.self) return { ok: false, value: { 存這一次被蓋住: save.top } };
		await tap(save.x, save.y);
		const after = await js(`return document.querySelectorAll('.card .day li').length`);
		const o = await overflow();
		return { ok: after === before + 1 && noOverflow(o), value: { 記了幾次: `${before} → ${after}`, ...o } };
	});
}

await check('390×844（觸控）練習記錄頁有 12 個動作：選動作是下拉選單，卡片不被動作清單擠到畫面外；選最後一個動作捲到它的卡片', async () => {
	await setTouchViewport(390, 844);
	await openPracticeFlow(`flow = core.updateSegment(flow, 's1', { eights: 16, lastBeats: 8 }).flow;
		for (let i = 1; i < 12; i++) {
			const r = core.addAction(flow, { segmentId: 's1', category: 'jump', name: '跳' + i, start: 16 * i, length: 16, note: '', members: [{ memberId: 'm1', role: null }] });
			flow = core.addPhase(r.flow, r.id, { kind: 'whole', name: '', beats: { at: 0, len: 16 } }).flow;
		}`);
	await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(300);
	const top = () => js(`const c = document.querySelector('.card'); return c ? Math.round(c.getBoundingClientRect().top) : null;`);
	const first = await top();
	const select = await js(`const s = document.querySelector('.record .pick select'); return s ? s.options.length : 0;`);
	if (select !== 12) return { ok: false, value: { 下拉選單的動作: select, 第一張卡的上緣: first } };
	await js(`const s = document.querySelector('.record .pick select'); s.value = s.options[11].value; s.dispatchEvent(new Event('change', { bubbles: true }));`);
	await sleep(800);
	const last = await top();
	const name = await js(`return document.querySelector('.card').getAttribute('aria-label')`);
	const inView = (y) => y !== null && y >= 0 && y < 844 - 100;
	return { ok: inView(first) && inView(last) && name === '小美', value: { 第一張卡的上緣: first, 選了跳11後: last, 卡: name } };
});
await check('390×844（觸控）：有未存的修改（練習記了一次）按上方列的「回首頁」，「還沒存」對話框按鈕點得到', async () => {
	await setTouchViewport(390, 844);
	await openPracticeFlow();
	await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(300);
	const recorded = await recordOnce();
	await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '編排').click()`);
	await sleep(300);
	const go = await js(`const b = [...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '回首頁');
		const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
	await tap(go.x, go.y);
	const res = await js(`const box = document.querySelector('.discard-box');
		if (!box) return { 打開了: false };
		const buttons = [...box.querySelectorAll('button')].map((b) => {
			const r = b.getBoundingClientRect();
			const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { 名字: b.textContent.trim(), 點得到: !!top && b.contains(top), 在畫面裡: r.left >= 0 && r.right <= innerWidth };
		});
		return { 打開了: true, buttons };`);
	// 回首頁，後面的檢查從乾淨的頁面開始
	await js(`[...document.querySelectorAll('.discard-box button')].find((b) => b.textContent.trim() === '不存了，繼續')?.click()`);
	await sleep(300);
	return { ok: recorded && res.打開了 && res.buttons.length === 3 && res.buttons.every((b) => b.點得到 && b.在畫面裡), value: { 記了一次: recorded, ...res } };
});
await check('390×844（觸控）檢視畫面：點播放鈕，播放頭會走', async () => {
	await setTouchViewport(390, 844);
	await openPracticeFlow();
	const at = () => js(`return document.querySelector('.phone-view .board .clock').textContent`);
	const before = await at();
	const play = await js(`const r = document.querySelector('.phone-view .transport .play').getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
	await tap(play.x, play.y);
	await sleep(1200);
	const after = await at();
	await js(`document.querySelector('.phone-view .transport .play').click()`);
	return { ok: before !== after, value: { 播放前: before, 播放後: after } };
});

await check('390×844（觸控）檢視畫面：播放前後播放鈕位置不變，第二下點同一個地方是暫停（#210）', async () => {
	await setTouchViewport(390, 844);
	await openSample();
	const btn = () => js(`const r = document.querySelector('.phone-view .transport .play').getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`);
	const before = await btn();
	await tap(before.x, before.y);
	// 播著的時候每隔一下量一次：八拍表這一列換列、時鐘變長都不能讓它跳（範例流程 9 秒，量 6 秒，還在播）
	const seen = [];
	for (let i = 0; i < 12; i++) { await sleep(500); seen.push(await btn()); }
	const moved = seen.filter((p) => p.x !== before.x || p.y !== before.y);
	await tap(before.x, before.y);
	const paused = await js(`return document.querySelector('.phone-view .transport .play').getAttribute('aria-label') === '播放'`);
	if (!paused) await js(`document.querySelector('.phone-view .transport .play').click()`);
	return { ok: moved.length === 0 && paused, value: { 播放前: before, 跳到: moved.slice(0, 3), 第二下暫停了: paused } };
});

for (const [w, h] of [[320, 640], [390, 844], [844, 390]]) {
	await check(`${w}×${h}（觸控）手機跳時間：回開頭、上一個／下一個八拍點得到、點了會跳；點時間打字的欄位在畫面裡、不溢出（#228）`, async () => {
		await setTouchViewport(w, h);
		await openSample();
		const spot = (sel) => js(`const el = document.querySelector('${sel}');
			if (!el) return null;
			const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: Math.round(r.height),
				self: !!t && el.contains(t) && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };`);
		const at = () => js(`return document.querySelector('.phone-view .pos')?.textContent ?? null`);
		const names = ['回開頭', '上一個八拍', '下一個八拍'];
		const buttons = {};
		for (const n of names) buttons[n] = await spot(`.phone-view .jump button[aria-label="${n}"]`);
		if (!names.every((n) => buttons[n]?.self && buttons[n].h >= 40)) return { ok: false, value: { 按鈕: buttons } };
		const start = await at();
		await tap(buttons['下一個八拍'].x, buttons['下一個八拍'].y);
		const next = await at();
		await tap(buttons['回開頭'].x, buttons['回開頭'].y);
		const back = await at();
		const board = await spot('.phone-view button.board');
		if (!board?.self) return { ok: false, value: { 時間點不到: board } };
		await tap(board.x, board.y);
		const box = await spot('.phone-view .jump-to input');
		const o = await overflow();
		await js(`document.activeElement?.blur()`);
		await sleep(200);
		const jumped = next !== start && back === start;
		return { ok: jumped && !!box?.self && noOverflow(o), value: { 開頭: start, 下一個八拍: next, 回開頭: back, 打字的欄位: box, ...o } };
	});
}

await check('844×390（手機橫拿）：檢視畫面和練習畫面都不溢出、播放鈕點得到', async () => {
	await setTouchViewport(844, 390);
	await openSample();
	const phone = await phoneView();
	const edit = await overflow();
	await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(300);
	const practice = await overflow();
	return { ok: phone.ok && noOverflow(edit) && noOverflow(practice), value: { 檢視畫面: phone.value, 編排: edit, 練習: practice } };
});
await check('390×844（觸控）：隊員開了流程檔，按上方列的「八拍表」看得到八拍表，選得了印誰、關得掉', async () => {
	await setTouchViewport(390, 844);
	await openPracticeFlow();
	const go = await js(`const b = document.querySelector('.topbar button[title="八拍表"]');
		if (!b) return null;
		const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
	if (!go) return { ok: false, value: '上方列沒有「八拍表」' };
	await tap(go.x, go.y);
	const res = await js(`const sheet = document.querySelector('.print-sheet');
		if (!sheet) return { 打開了: false };
		const hit = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return !!t && el.contains(t) && r.left >= 0 && r.right <= innerWidth; };
		const close = [...sheet.querySelectorAll('button')].find((b) => b.textContent.trim() === '關閉');
		return { 打開了: true, 印誰點得到: hit(sheet.querySelector('select')), 關閉點得到: hit(close), 表格有列: sheet.querySelectorAll('tbody tr').length };`);
	const o = await overflow();
	return {
		ok: res.打開了 && res.印誰點得到 && res.關閉點得到 && res.表格有列 > 0 && o.頁寬 <= o.畫面寬,
		value: { ...res, 頁寬: o.頁寬, 畫面寬: o.畫面寬 }
	};
});

/**
 * 看得到的按鈕、輸入框、選單、勾選框那一行、場上的圓點：手指點得到的範圍（從中心往上下左右，最上面還是它自己的地方）
 * 寬和高都至少 32px。點得到的範圍可以比看起來大（::after 放大）。時間軸上的段、色條、走位條照時間長短畫，不量。
 * 每個先捲到捲動範圍的中間再量。
 */
const smallTargets = () =>
	js(`const sel = 'button, a[href], select, input, label:has(> input[type=checkbox]), label:has(> input[type=radio]), .field g.dot';
		const skip = '.timeline .seg, .timeline .bar, .timeline .walk, label input';
		const bad = [];
		let n = 0;
		for (const el of document.querySelectorAll(sel)) {
			if (el.matches(skip) || !el.checkVisibility()) continue;
			const r0 = el.getBoundingClientRect();
			if (r0.width < 3 || r0.height < 3) continue;
			el.scrollIntoView({ block: 'center', inline: 'nearest' });
			const r = el.getBoundingClientRect();
			if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) continue;
			const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
			const hits = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && el.contains(t); };
			if (!hits(cx, cy)) continue;
			n++;
			const reach = (dx, dy) => { let d = 0; while (d < 40 && hits(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
			const w = reach(-1, 0) + reach(1, 0) + 1, h = reach(0, -1) + reach(0, 1) + 1;
			const name = (el.getAttribute('aria-label') || el.textContent || el.type || '').trim().slice(0, 12);
			if (w < 32 || h < 32) bad.push(name + '：點得到 ' + w + '×' + h);
		}
		return { 量了幾個: n, 太小的: bad };`);

await check('1024×768（觸控）：圓點和按鈕、輸入框、勾選框點得到的範圍都至少 32px', async () => {
	await setTouchViewport(1024, 768);
	await openSample();
	const res = {};
	res.開檔 = await smallTargets();
	const dot = await js(`const c = document.querySelector('.field g.dot circle.base, .field g.dot circle.top').getBoundingClientRect(); return Math.round(c.width);`);
	await js(`document.getElementById('tab-members').click()`);
	await sleep(300);
	res.隊員 = await smallTargets();
	await js(`document.querySelector('[data-action-id]').click()`);
	await sleep(300);
	res.選了動作 = await smallTargets();
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.title === '流程設定').click()`);
	await sleep(300);
	res.流程設定 = await smallTargets();
	const ok = dot >= 32 && Object.values(res).every((r) => r.量了幾個 > 0 && r.太小的.length === 0);
	return { ok, value: { 圓點直徑: dot, ...res } };
});
await check('1024×768（觸控）：40 人、場外排了人時，條編號不被（放大了的）圓點蓋住', async () => {
	await setTouchViewport(1024, 768);
	const bad = [];
	for (const field of [{ strips: 1, layout: 'vertical' }, { strips: 1, layout: 'horizontal' }]) {
		await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
		await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
		await sleep(300);
		// 小場地：格點不夠 40 人，剩下的人排在場外
		await js(`const core = await import('/src/lib/core/index.ts');
			let f = core.createFlow({ name: '四十人', field: ${JSON.stringify(field)} }).flow;
			f = core.addMembers(f, Array.from({ length: 40 }, (_, i) => ({ name: '隊員' + (i + 1), gender: 'F', globalRole: 'base' }))).flow;
			const input = document.querySelector('.home-open input[type=file]');
			const dt = new DataTransfer();
			dt.items.add(new File([core.writeFlowFile(f, {})], '四十人.zip', { type: 'application/zip' }));
			input.files = dt.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));`);
		await waitFor(() => js(`return !!document.querySelector('.rail')`));
		await sleep(500);
		const covered = await js(`const dots = [...document.querySelectorAll('.field g.dot')].map((d) => d.getBoundingClientRect());
			return [...document.querySelectorAll('[data-strip-number]')].flatMap((t) => {
				const r = t.getBoundingClientRect();
				const box = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round);
				const hits = dots.filter((d) => d.left < r.right && d.right > r.left && d.top < r.bottom && d.bottom > r.top);
				return hits.length ? [{ 編號: t.textContent, 編號的框: box(r), 蓋到的圓點: hits.map(box) }] : [];
			});`);
		if (covered.length) bad.push({ 場地: field, 被蓋住的條編號: covered });
	}
	return { ok: bad.length === 0, value: bad };
});

await clearTouch();

// ---------- 八拍表、記一次全上表、總表：畫面上和印出來 ----------

await check('768×1024 八拍表的標題列：「八拍表」「印誰」各自一行，不擠成直排', async () => {
	await setViewport(768, 1024);
	await openSample();
	await js(`document.querySelector('.topbar button[title="八拍表"]').click()`);
	await sleep(300);
	// 數字自己那一段字排成幾行（每個字一行就是直排）
	return js(`const one = (sel) => { const el = document.querySelector(sel);
			const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
			const range = document.createRange(); range.selectNodeContents(text);
			const lines = new Set([...range.getClientRects()].filter((r) => r.width).map((r) => Math.round(r.top))).size;
			return { 字: text.textContent.trim(), 行數: lines, 一行: lines === 1 }; };
		const title = one('.print-sheet .tool-title'), who = one('.print-sheet .toolbar label');
		const seg = one('.print-sheet td.seg');
		return { ok: title.一行 && who.一行 && seg.一行, value: { 八拍表: title, 印誰: who, 段: seg } };`);
});

await check('1440×900 記一次全上 40 人：只有表格左右捲，不撐開整頁', async () => {
	await setViewport(1440, 900);
	await openBigFlow();
	await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(200);
	await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('記一次全上')).click()`);
	await sleep(300);
	return js(`const sheet = document.querySelector('.sheet');
		const scroll = sheet.querySelector('.scroll');
		const practice = document.querySelector('.practice');
		const date = document.querySelector('.practice .date').getBoundingClientRect();
		const r = sheet.getBoundingClientRect();
		const v = { 頁寬: document.scrollingElement.scrollWidth, 練習寬: [practice.scrollWidth, practice.clientWidth],
			全上表右邊: Math.round(r.right), 畫面寬: innerWidth, 表格自己捲: scroll.scrollWidth > scroll.clientWidth, 日期右邊: Math.round(date.right) };
		return { ok: v.頁寬 <= innerWidth && practice.scrollWidth <= practice.clientWidth + 1 && r.right <= innerWidth && v.表格自己捲 && date.right <= innerWidth, value: v };`);
});

/** 表格往右捲到底：第一欄（環節）還在表格看得到的左邊，沒被捲走。 */
const firstColumnStays = (block) =>
	js(`const scroll = document.querySelector(${JSON.stringify(block)} + ' .scroll');
		scroll.scrollLeft = scroll.scrollWidth;
		await new Promise((r) => setTimeout(r, 100));
		const box = scroll.getBoundingClientRect();
		const heads = [...scroll.querySelectorAll('tr > th:first-child')].map((th) => Math.round(th.getBoundingClientRect().left - box.left));
		scroll.scrollLeft = 0;
		return { ok: scroll.scrollWidth > scroll.clientWidth && heads.every((x) => Math.abs(x) <= 1), value: { 第一欄離表格左邊: heads } };`);

await check('1440×900 記一次全上 40 人：往右捲時「環節」那一欄留在左邊；整張表一個畫面看得完，「存這次全上」不用捲整頁就按得到', async () => {
	// 上一條已經開著 40 人的全上表
	const first = await firstColumnStays('.sheet .block');
	const r = await js(`const sheet = document.querySelector('.sheet').getBoundingClientRect();
		const save = [...document.querySelectorAll('.sheet footer button')].find((b) => b.textContent.trim() === '存這次全上').getBoundingClientRect();
		return { 全上表高: Math.round(sheet.height), 存的鈕下緣: Math.round(save.bottom), 畫面高: innerHeight };`);
	return { ok: first.ok && r.存的鈕下緣 <= r.畫面高, value: { ...first.value, ...r } };
});

/** 用列印的媒體查詢量：A4 直的扣掉邊界大約 718px 寬。 */
async function asPrinted(fn) {
	await setViewport(718, 1000);
	await send('Emulation.setEmulatedMedia', { media: 'print' });
	await sleep(300);
	try { return await fn(); } finally { await send('Emulation.setEmulatedMedia', { media: '' }); }
}
/** 印出來：表格都不超出紙寬，App 的上方列和按鈕（表格裡的格子以外）都不印。 */
const printedTables = () =>
	js(`const shown = (el) => el.checkVisibility();
		const tables = [...document.querySelectorAll('table')].filter(shown).map((t) => Math.round(t.getBoundingClientRect().right));
		const buttons = [...document.querySelectorAll('button')].filter((b) => shown(b) && !b.closest('table')).map((b) => b.textContent.trim().slice(0, 12));
		const v = { 紙寬: innerWidth, 頁寬: document.scrollingElement.scrollWidth, 表格右邊: tables, 上方列印出來: shown(document.querySelector('.topbar')), 印出來的按鈕: buttons };
		return { ok: tables.length > 0 && tables.every((r) => r <= innerWidth) && v.頁寬 <= innerWidth && !v.上方列印出來 && buttons.length === 0, value: v };`);

await check('列印：記一次全上 40 人只印表格，欄位不超出紙寬，不印上方列和按鈕', async () => {
	// 上一條已經開著 40 人的全上表
	return asPrinted(printedTables);
});

await check('列印：總表 40 人只印表格，欄位不超出紙寬，不印上方列和按鈕', async () => {
	await js(`[...document.querySelectorAll('.sheet footer button')].find((b) => b.textContent.trim() === '取消').click()`);
	await sleep(200);
	// 改過格子的話會先問；沒改過直接回去
	await js(`[...document.querySelectorAll('.practice .pages button')].find((b) => b.textContent.trim() === '總表').click()`);
	await sleep(300);
	return asPrinted(printedTables);
});

await check('1440×900 總表 40 人：往右捲時「環節」那一欄留在左邊', async () => {
	// 上一條開著 40 人的總表
	return firstColumnStays('.summary .block');
});

await check('列印：八拍表的拍點、環節換行不截斷，背景是白的', async () => {
	await js(`[...document.querySelectorAll('.topbar .view button')].find((b) => b.textContent.trim() === '編排').click()`);
	await sleep(200);
	await js(`document.querySelector('.topbar button[title="八拍表"]').click()`);
	await sleep(300);
	return asPrinted(() =>
		js(`const cut = [...document.querySelectorAll('.print-sheet .cue, .print-sheet .phase')]
				.filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' || el.scrollWidth > el.clientWidth + 1)
				.map((el) => el.textContent.trim().slice(0, 20));
			const bg = [document.documentElement, document.body, document.querySelector('.print-sheet')].map((el) => getComputedStyle(el).backgroundColor);
			const white = bg.every((c) => c === 'rgb(255, 255, 255)' || c === 'rgba(0, 0, 0, 0)');
			const table = document.querySelector('.print-sheet table').getBoundingClientRect();
			return { ok: cut.length === 0 && white && table.right <= innerWidth,
				value: { 被截斷的: cut, 背景: bg, 表格右邊: Math.round(table.right), 紙寬: innerWidth } };`)
	);
});

// ---------- 八拍表在手機和列印（#160） ----------

/**
 * 開一份比較滿的流程：libSample 加一張名字很長的站位、名字 20 個字的隊員、
 * 動作備註、一段口號（「整段 N 秒」）。量八拍表的動作欄。
 */
const fullSheetFlow = () =>
	openPracticeFlow(`flow = core.insertFormation(flow, 3.2).flow;
		flow = core.renameFormation(flow, flow.formations.at(-1).id, '很長的站位名字一二三四五六七八九十').flow;
		flow = core.updateMember(flow, 'm1', { name: '名字有二十個字的隊員一二三四五六七八九十' }).flow;
		flow = core.updateAction(flow, 'x1', { note: '下來的時候小心，上層要看前面' }).flow;
		flow = core.addSegment(flow, 'chant').flow;`);
const openEightCount = async () => {
	await js(`document.querySelector('.topbar button[title="八拍表"]').click()`);
	await sleep(400);
};
/** 八拍表動作欄：每段字每一行（最後一行以外）有幾個字，取最少的；一字一行就是 1。 */
const actionLines = () =>
	js(`const counts = [];
		for (const el of document.querySelectorAll('.print-sheet .action')) {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const tops = new Map();
				for (let i = 0; i < node.length; i++) {
					if (!node.data[i].trim()) continue;
					const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
					const r = range.getBoundingClientRect(); if (!r.width) continue;
					const t = Math.round(r.top); tops.set(t, (tops.get(t) ?? 0) + 1);
				}
				const lines = [...tops.values()]; lines.pop();
				counts.push(...lines);
			}
		}
		const cell = document.querySelector('.print-sheet .action').closest('td').getBoundingClientRect();
		return { 最少一行幾個字: counts.length ? Math.min(...counts) : '都只有一行', 動作欄寬: Math.round(cell.width) };`);
const manyChars = (n) => n === '都只有一行' || n > 1;

await check('390×844（觸控）八拍表：直排卡片（站位圖在動作下面），沒有橫向捲動，捲到最下面關閉鈕還點得到', async () => {
	await setTouchViewport(390, 844);
	await fullSheetFlow();
	await openEightCount();
	const r = await js(`const sheet = document.querySelector('.print-sheet');
		sheet.scrollTop = sheet.scrollHeight;
		await new Promise((r) => setTimeout(r, 200));
		const close = [...sheet.querySelectorAll('button')].find((b) => b.textContent.trim() === '關閉');
		const c = close.getBoundingClientRect();
		const top = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
		// 有站位的那一張卡：站位圖在動作底下
		const card = [...sheet.querySelectorAll('tbody')].find((b) => b.querySelector('figure') && b.querySelector('.action'));
		const fig = card.querySelector('figure').getBoundingClientRect(), act = card.querySelector('.action').getBoundingClientRect();
		// 小站位圖裡的線和格子被圖框裁掉，不算
		const out = [...sheet.querySelectorAll('*')].filter((el) => !el.ownerSVGElement).filter((el) => { const b = el.getBoundingClientRect(); return b.width && el.checkVisibility() && b.right > innerWidth + 1; })
			.map((el) => el.outerHTML.slice(0, 50));
		return { 表要左右捲: sheet.scrollWidth > sheet.clientWidth, 跑出去的: out.slice(0, 3),
			關閉點得到: !!top && close.contains(top) && c.left >= 0 && c.right <= innerWidth, 站位圖在動作下面: fig.top >= act.bottom - 1 };`);
	const lines = await actionLines();
	await clearTouch();
	return { ok: !r.表要左右捲 && !r.跑出去的.length && r.關閉點得到 && r.站位圖在動作下面 && manyChars(lines.最少一行幾個字), value: { ...r, ...lines } };
});

await check('列印 A4 直印八拍表：動作欄每行超過一個字', async () => {
	await setViewport(1440, 900);
	await fullSheetFlow();
	await openEightCount();
	return asPrinted(async () => {
		const lines = await actionLines();
		return { ok: manyChars(lines.最少一行幾個字) && lines.動作欄寬 >= 240, value: lines };
	});
});

await check('列印八拍表（40 人）：每張小站位圖範圍一樣（所有站位有人處合起來），圓點上的號碼看得清楚（#217）', async () => {
	// 站位 1 全隊往中間縮一半，第 2 個八拍開頭的站位 2 散回原本的位置：兩張合起來的範圍比站位 1 大
	await setViewport(1440, 900);
	await openBigFlow(`const spread = flow.formations[0].pos;
		const half = Object.fromEntries(Object.entries(spread).map(([id, [x, y]]) => [id, [x / 2, y / 2]]));
		flow = of(c.setPositions(flow, flow.formations[0].id, half));
		flow = of(c.insertFormation(flow, 3.2));
		flow = of(c.setPositions(flow, flow.formations[1].id, spread));`);
	await openEightCount();
	return asPrinted(() =>
		js(`const figs = [...document.querySelectorAll('.print-sheet figure svg')];
			const boxes = [...new Set(figs.map((s) => s.getAttribute('viewBox')))];
			const nums = [...document.querySelectorAll('.print-sheet figure .dot text')].map((t) => t.getBoundingClientRect().height);
			const 號碼最小高 = Math.round(Math.min(...nums) * 10) / 10;
			return { ok: figs.length === 2 && boxes.length === 1 && 號碼最小高 >= 9, value: { 圖: figs.length, 範圍: boxes, 號碼最小高 } };`)
	);
});

await check('列印八拍表：沒有焦點外框；放得下一頁的列不切開，比一頁長的列可以切（不整列推到下一頁）', async () => {
	// 上一條開著八拍表：焦點在表上按一下 ↓（鍵盤焦點才畫外框）
	await js(`document.querySelector('.print-sheet').focus()`);
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
	const outline = await asPrinted(() =>
		js(`const sheet = document.querySelector('.print-sheet'), s = getComputedStyle(sheet);
			return { 鍵盤焦點在表上: sheet.matches(':focus-visible'), 外框: s.outlineStyle === 'none' ? 'none' : s.outlineStyle + ' ' + s.outlineWidth };`)
	);
	// 第 2 個八拍 5 張站位（放得下一頁），第 3 個八拍 7 張（放不下）
	await openPracticeFlow(`for (let i = 0; i < 5; i++) flow = core.insertFormation(flow, 3.2 + i * 0.4).flow;
		for (let i = 0; i < 7; i++) flow = core.insertFormation(flow, 6.4 + i * 0.4).flow;`);
	await openEightCount();
	// A4 直的扣掉邊界，一頁大約 1046px 高
	const rows = await asPrinted(() =>
		js(`return [...document.querySelectorAll('.print-sheet tbody')].map((b) => ({
				八拍: b.querySelector('td.seg + td').textContent, 高: Math.round(b.getBoundingClientRect().height), 不切開: getComputedStyle(b).breakInside === 'avoid' }));`)
	);
	const ok = outline.鍵盤焦點在表上 && outline.外框 === 'none' &&
		rows.every((r) => r.不切開 === r.高 <= 1046) && rows.some((r) => !r.不切開) && rows.filter((r) => r.不切開).length >= 3;
	return { ok, value: { ...outline, 列: rows } };
});

await check('390×844（手機）使用說明：名詞表上下排，不用左右滑；看得到短提示、點得到「回目錄」', async () => {
	await setTouchViewport(390, 844);
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/guide?from=editor` });
	await waitFor(() => js(`return !!document.querySelector('#words table')`));
	await sleep(300);
	const r = await js(`const wraps = [...document.querySelectorAll('.table-wrap')].map((w) => ({
			表: w.querySelector('th')?.textContent, 內容寬: w.scrollWidth, 框寬: w.clientWidth }));
		document.querySelector('#practice').scrollIntoView();
		await new Promise((r) => setTimeout(r, 150));
		const top = document.querySelector('.to-toc');
		const b = top.getBoundingClientRect();
		const hint = document.querySelector('.head-hint-short').getBoundingClientRect();
		return { 要滑的表: wraps.filter((w) => w.內容寬 > w.框寬 + 1), 頁寬: document.scrollingElement.scrollWidth, 畫面寬: innerWidth,
			短提示寬: Math.round(hint.width), 大標題是按鈕: document.querySelector('.head .brand').tagName === 'BUTTON',
			回目錄點得到: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === top };`);
	const atToc = await js(`document.querySelector('.to-toc').click(); await new Promise((r) => setTimeout(r, 300));
		return Math.round(document.querySelector('#toc').getBoundingClientRect().top);`);
	await clearTouch();
	return {
		ok: r.要滑的表.length === 0 && r.頁寬 <= r.畫面寬 && r.短提示寬 > 0 && r.大標題是按鈕 && r.回目錄點得到 && atToc >= 0 && atToc < 200,
		value: { ...r, 按了回目錄目錄在: atToc }
	};
});

await check('1440×900 右邊欄是新動作表單：「新增動作」不用捲就看得到、點得到（黏在右邊欄底部）', async () => {
	await setViewport(1440, 900);
	await openSample();
	// 選全隊：新動作表單列出所有人，表單比右邊欄長
	await js(`[...document.querySelectorAll('.inspector button')].find((b) => b.textContent.trim() === '全隊').click()`);
	await sleep(300);
	const r = await js(`const panel = document.querySelector('#panel-action'); panel.scrollTop = 0;
		await new Promise((r) => setTimeout(r, 150));
		const b = document.querySelector('.action-form .add').getBoundingClientRect();
		const p = panel.getBoundingClientRect();
		const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
		return { 點得到: hit === document.querySelector('.action-form .add'), 按鈕: [Math.round(b.top), Math.round(b.bottom)],
			右邊欄: [Math.round(p.top), Math.round(p.bottom)], 右邊欄要捲: panel.scrollHeight > panel.clientHeight };`);
	return { ok: r.點得到 && r.按鈕[1] <= r.右邊欄[1] && r.右邊欄要捲, value: r };
});

// ---------- 舊畫面整理：錯誤訊息貼著欄位、黏底按鈕不蓋欄位、「⋯」小窗（#214） ----------

/** 開範例流程、選全隊：右邊欄是打開的新動作表單，捲回最上面。 */
async function newActionForm(w, h) {
	await setViewport(w, h);
	await openSample();
	await js(`[...document.querySelectorAll('.inspector button')].find((b) => b.textContent.trim() === '全隊').click()`);
	await sleep(300);
	await js(`document.querySelector('#panel-action').scrollTop = 0`);
	await sleep(150);
}

/**
 * 欄位跟黏底的「新增動作」那一條有沒有疊到；欄位在右邊欄看得到的範圍外（還沒捲到）不算被蓋。
 * 看得到的欄位要整個在那一條上面。
 */
const fieldClear = (label) =>
	js(`const el = document.querySelector('.action-form input[aria-label="${label}"]');
		const r = el.getBoundingClientRect();
		const bar = document.querySelector('.action-form .add-bar').getBoundingClientRect();
		const panel = document.querySelector('#panel-action').getBoundingClientRect();
		const inView = r.bottom > panel.top && r.top < panel.bottom;
		return { 沒被蓋: !inView || r.bottom <= bar.top, 看得到: inView, 欄位: [Math.round(r.top), Math.round(r.bottom)], 那一條: [Math.round(bar.top), Math.round(bar.bottom)] };`);

await check('1280×720 新動作表單：黏底的「新增動作」不蓋住開始、長度（剛打開時、欄位在那一條後面時 Tab 進去）', async () => {
	await newActionForm(1280, 720);
	const seen = { 剛打開: { 開始: await fieldClear('開始'), 長度: await fieldClear('長度') } };
	for (const label of ['開始', '長度']) {
		// 把欄位捲到黏底那一條後面，再讓它拿到焦點（跟 Tab 進去一樣）：瀏覽器捲進來時要躲開那一條
		await js(`const panel = document.querySelector('#panel-action');
			const el = document.querySelector('.action-form input[aria-label="${label}"]');
			const bar = document.querySelector('.action-form .add-bar').getBoundingClientRect();
			panel.scrollTop += el.getBoundingClientRect().bottom - bar.bottom + 2;
			document.activeElement?.blur();
			el.focus();`);
		await sleep(300);
		seen[`Tab 進${label}`] = await fieldClear(label);
	}
	const ok = seen.剛打開.開始.沒被蓋 && seen.剛打開.長度.沒被蓋 &&
		['開始', '長度'].every((l) => seen[`Tab 進${l}`].看得到 && seen[`Tab 進${l}`].沒被蓋);
	return { ok, value: seen };
});

await check('1280×720 新動作表單：開始欄打看不懂的按 Enter，原因就寫在開始欄下面、看得到，右邊欄沒有自己捲', async () => {
	await newActionForm(1280, 720);
	await js(`const el = document.querySelector('.action-form input[aria-label="開始"]');
		el.focus(); el.value = 'abc'; el.dispatchEvent(new Event('input', { bubbles: true }));`);
	const before = await js(`return document.querySelector('#panel-action').scrollTop`);
	await press('Enter');
	await sleep(300);
	const r = await js(`const start = document.querySelector('.action-form input[aria-label="開始"]').getBoundingClientRect();
		const alert = document.querySelector('.action-form [role=alert]');
		if (!alert) return { 有原因: false };
		const a = alert.getBoundingClientRect();
		const t = document.elementFromPoint(a.left + 10, a.top + a.height / 2);
		return { 有原因: true, 原因: alert.textContent, 開始欄: [Math.round(start.left), Math.round(start.bottom)],
			原因的位置: [Math.round(a.left), Math.round(a.top)], 看得到: !!t && alert.contains(t),
			右邊欄捲: document.querySelector('#panel-action').scrollTop };`);
	const ok = r.有原因 && r.看得到 && r.原因的位置[1] - r.開始欄[1] >= 0 && r.原因的位置[1] - r.開始欄[1] <= 40 &&
		Math.abs(r.原因的位置[0] - r.開始欄[0]) <= 20 && r.右邊欄捲 === before;
	return { ok, value: { ...r, 原本捲: before } };
});

await check('1280×720 場地左下的「圖例」點得到：收起來後圖例不佔位置，「圖例」鈕還在、再點打開', async () => {
	await setViewport(1280, 720);
	await openSample();
	const rail = await rectOf('.rail');
	await wheel(rail.x, rail.y, 2000);
	const first = await hitAndClick('.rail .legend-toggle');
	const shut = await js(`const box = document.querySelector('.rail .legend-box');
		const t = document.querySelector('.rail .legend-toggle');
		return { 收起來: box.getBoundingClientRect().height === 0, 箭頭: t.textContent.trim(), 開著: t.getAttribute('aria-expanded') };`);
	await wheel(rail.x, rail.y, 2000);
	const again = await hitAndClick('.rail .legend-toggle');
	const open = await js(`return document.querySelector('.rail .legend-box').getBoundingClientRect().height > 0`);
	return { ok: first.self && again.self && shut.收起來 && shut.開著 === 'false' && open, value: { 第一次點: first, 收起來: shut, 再點: again, 打開了: open } };
});

await check('1280×720 播放列的「⋯」點得到，打開的小窗（延遲校正）整個在畫面裡', async () => {
	await setViewport(1280, 720);
	await openSample();
	const hit = await hitAndClick('.transport .more');
	await sleep(200);
	const corners = await js(`return !!document.querySelector('.more-pop')`) ? await cornersVisible('.more-pop') : { ok: false, value: '沒打開' };
	await press('Escape');
	return { ok: hit.self && corners.ok, value: { 點到: hit, 小窗: corners.value } };
});

// ---------- 撞位的 ✕、場地中心記號（#133） ----------

await check('1440×1000 滑鼠移到場上撞位的 ✕ 上，接得到滑鼠、有「撞位：誰、誰」；場地中心記號是「＋」不是 ✕', async () => {
	await setViewport(1440, 1000);
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	// 小A 在騰翻裡從 [-3, 3] 走到 [3, 3]，經過站在 [0, 3.85] 的小B：✕ 畫在 [0, 3.425]，離場地中心遠。
	await js(`const c = await import('/src/lib/core/index.ts');
		const of = (r) => { if (r.kind !== 'ok') throw new Error(JSON.stringify(r)); return r.flow; };
		let flow = of(c.createFlow({ name: '撞位', field: { strips: 9, layout: 'vertical' } }));
		flow = of(c.addMembers(flow, ['小A', '小B'].map((name) => ({ name, gender: 'F', globalRole: 'base' }))));
		flow = of(c.addSegment(flow, 'music'));
		flow = of(c.setPositions(flow, 'f1', { m1: [-3, 3], m2: [0, 3.85] }));
		flow = of(c.insertFormation(flow, 4.8));
		flow = of(c.setPositions(flow, flow.formations[1].id, { m1: [3, 3] }));
		flow = of(c.addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 0, length: 24, note: '',
			members: [{ memberId: 'm1', role: null }] }));
		const input = document.querySelector('.home-open input[type=file]');
		const dt = new DataTransfer();
		dt.items.add(new File([c.writeFlowFile(flow, {})], '撞位.zip', { type: 'application/zip' }));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));`);
	await waitFor(() => js(`return !!document.querySelector('.rail')`));
	await sleep(300);
	await js(`[...document.querySelectorAll('.row.film .pick')][1].click()`);
	await sleep(300);
	const clash = await js(`const x = document.querySelector('.field [data-clash]');
		if (!x) return { 有: false };
		const r = x.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
		const top = document.elementFromPoint(cx, cy);
		return { 有: true, 接得到滑鼠: top === x, 最上面: top?.outerHTML.slice(0, 80), 說明: x.querySelector('title')?.textContent };`);
	// 「＋」的橫線上有東西、斜角上沒有；「✕」剛好相反。
	const center = await js(`const el = document.querySelector('.field .center');
		const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = r.width * 0.35;
		return { 橫線上: document.elementFromPoint(cx + d, cy) === el, 斜角上: document.elementFromPoint(cx + d, cy + d) === el };`);
	return {
		ok: clash.接得到滑鼠 && clash.說明 === '撞位：小A、小B' && center.橫線上 && !center.斜角上,
		value: { 撞位: clash, 中心記號: center }
	};
});

await check('1440×1000 左欄的「跟上一張一樣」：播放頭在站位上和不在站位上，按鈕位置一樣', async () => {
	await setViewport(1440, 1000);
	await openSample();
	const spot = () => js(`const b = [...document.querySelectorAll('.rail button')].find((x) => x.textContent.trim() === '跟上一張一樣');
		const r = b.getBoundingClientRect();
		return { 在站位上: !!document.querySelector('.rail .here.on'), 位置: [Math.round(r.left), Math.round(r.top)] };`);
	await js(`[...document.querySelectorAll('.row.film .pick')][1].click()`);
	await sleep(300);
	const on = await spot();
	// 往後一拍：離開站位
	await js(`document.activeElement?.blur(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
	await sleep(300);
	const off = await spot();
	const ok = on.在站位上 && !off.在站位上 && on.位置[0] === off.位置[0] && on.位置[1] === off.位置[1];
	return { ok, value: { 在站位上: on, 不在站位上: off } };
});

// ---------- 長的拍點文字（#146） ----------

await check('很長的手位：拍點格子、泳道、八拍表上都待在自己那一拍，不蓋到下一個拍點', async () => {
	await setViewport(1440, 900);
	const long = '雙手從胸前握拳往上推到高V再往兩邊打開';
	await openPracticeFlow(`flow = core.placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: '${long}' }).flow;
		flow = core.placeCue(flow, 'x1', { kind: 'motion', at: 2, len: 2, word: '拳頭' }).flow;`);
	await js(`document.querySelector('[data-lane="m1"] [data-action-id="x1"]').click()`);
	await sleep(300);
	const grid = await js(`const items = [...document.querySelectorAll('.cues .item.motion')];
		const slot = document.querySelector('.cues .slot.motion[data-at="0"]').getBoundingClientRect();
		const r = items[0].getBoundingClientRect();
		return { ok: r.right <= slot.right + 1, 手位: [Math.round(r.left), Math.round(r.right)], 那一拍: [Math.round(slot.left), Math.round(slot.right)], 看全文: items[0].title };`);
	const lane = await js(`const [a, b] = [...document.querySelectorAll('[data-lane="m1"] .cue.motion')].map((e) => e.getBoundingClientRect());
		return { ok: a.right <= b.left + 1, 長的: [Math.round(a.left), Math.round(a.right)], 下一個: [Math.round(b.left), Math.round(b.right)] };`);
	await js(`document.querySelector('.topbar button[title="八拍表"]').click()`);
	await sleep(400);
	const sheet = await js(`const cue = [...document.querySelectorAll('.print-sheet .cue.motion')][0].getBoundingClientRect();
		const n1 = document.querySelector('.print-sheet .cells .n').getBoundingClientRect();
		return { ok: cue.right <= n1.right + 1, 手位: [Math.round(cue.left), Math.round(cue.right)], 第1拍: [Math.round(n1.left), Math.round(n1.right)] };`);
	await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	return { ok: grid.ok && !!grid.看全文 && lane.ok && sheet.ok, value: { 拍點格子: grid, 泳道: lane, 八拍表: sheet } };
});

// ---------- 記錄卡不位移（#142） ----------

await check('記錄頁：點第一個環節前後「存這一次」不動；存好、刪掉之後「刪掉上一次」和左邊清單不動', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow(`flow = (await import('/src/lib/test-flows.ts')).ratedSample();`);
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(300);
	const spot = (selector) => js(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)];`);
	const press = async (selector) => { const p = await rectOf(selector); await click(p.x, p.y); await sleep(200); };
	await js(`document.querySelectorAll('.record .list li')[1].classList.add('second')`);
	const saveSpot = [await spot('.card .save')];
	const undoSpot = [await spot('.card .undo-last')];
	const listSpot = [await spot('.record .list .second')];
	await press('.card button[aria-label$="上法 成功"]');
	saveSpot.push(await spot('.card .save'));
	await press('.card .save');
	undoSpot.push(await spot('.card .undo-last'));
	listSpot.push(await spot('.record .list .second'));
	await press('.card .undo-last');
	undoSpot.push(await spot('.card .undo-last'));
	const same = (spots) => spots.every(([x, y]) => x === spots[0][0] && y === spots[0][1]);
	return {
		ok: same(saveSpot) && same(undoSpot) && same(listSpot),
		value: { 存這一次: saveSpot, '刪掉上一次（存前、存後、刪後）': undoSpot, 清單第二個動作: listSpot }
	};
});

// ---------- 「已做了・復原」提示不推動版面（#211） ----------

await check('記錄頁：「已存」「已刪掉…救回」提示出現、換掉、收掉時，卡片、上面那一排和左邊清單都不動；同時只有一則，浮在畫面上', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow(`flow = (await import('/src/lib/test-flows.ts')).ratedSample();`);
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '練習').click()`);
	await sleep(300);
	const press = async (selector) => { const p = await rectOf(selector); await click(p.x, p.y); await sleep(200); };
	const spots = () => js(`return ['.run', '.record .list', '.card', '.card .undo-last'].map((s) => {
		const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.height)].join(','); });`);
	// 看得到的提示（編排畫面藏起來時，場地上那一份不算）
	const toasts = () => js(`return [...document.querySelectorAll('.toast')].filter((t) => t.getClientRects().length).map((t) => t.textContent.trim() + '｜' + getComputedStyle(t).position)`);
	await press('.card button[aria-label$="上法 成功"]');
	const before = await spots();
	await press('.card .save');
	const saved = { 位置: await spots(), 提示: await toasts() };
	await press('.card .undo-last');
	const removed = { 位置: await spots(), 提示: await toasts() };
	await js(`document.querySelector('.toast button[aria-label="收起提示"]').click()`);
	await sleep(200);
	const gone = { 位置: await spots(), 提示: await toasts() };
	const same = [saved, removed, gone].every((v) => String(v.位置) === String(before));
	const one = (v, text) => v.提示.length === 1 && v.提示[0].startsWith(text) && v.提示[0].endsWith('｜absolute');
	return {
		ok: same && one(saved, '已存') && one(removed, '已刪掉') && gone.提示.length === 0,
		value: { 之前: before, 存好: saved, 刪掉: removed, 收掉: gone }
	};
});

// ---------- 時間軸：自動符合寬度、刻度不擠、站位小圖（#152） ----------

/** 時間軸看得到的寬、捲得到的寬、流程（八拍尺）多寬、最後一張縮圖的右緣（從時間軸左緣算）。 */
const timelineFill = () =>
	js(`const t = document.querySelector('.timeline'); const tr = t.getBoundingClientRect();
		const ths = [...t.querySelectorAll('.film .th')].map((e) => e.getBoundingClientRect().right - tr.left);
		return { 看得到: t.clientWidth, 捲得到: t.scrollWidth, 流程: Math.round(t.querySelector('.ruler').getBoundingClientRect().width),
			最後縮圖右緣: Math.round(Math.max(...ths)), 倍數: t.querySelector('.zoom-val').textContent };`);

await check('1920×1080 開範例流程（不按「符合寬度」）：流程放滿時間軸，最後一張縮圖也在畫面裡，沒有橫向捲軸', async () => {
	await setViewport(1920, 1080);
	await openSample();
	const m = await timelineFill();
	return { ok: m.捲得到 <= m.看得到 && m.流程 >= (m.看得到 - 148) * 0.9 && m.最後縮圖右緣 <= m.看得到, value: m };
});

await check('1920 開範例流程後縮成 1280 寬：還是放滿，沒有橫向捲軸', async () => {
	await setViewport(1280, 900);
	await sleep(300);
	const m = await timelineFill();
	return { ok: m.捲得到 <= m.看得到 && m.流程 >= (m.看得到 - 148) * 0.9, value: m };
});

/** 八拍尺上看得到的刻度字，有沒有兩個疊在一起。 */
const rulerOverlaps = () =>
	js(`const spans = [...document.querySelectorAll('.timeline .ruler .tk span')].map((s) => {
			const r = s.getBoundingClientRect(); return { t: s.textContent, l: r.left, r: r.right }; });
		const bad = [];
		for (let i = 1; i < spans.length; i++) if (spans[i].l < spans[i - 1].r - 0.5) bad.push(spans[i - 1].t + '|' + spans[i].t);
		return { 字: spans.length, 疊到的: bad.slice(0, 8) };`);

await check('時間軸縮到最小：八拍號碼不疊在一起；音樂段最後一個八拍只有 1 拍、後面接口號段，段交界也不疊', async () => {
	await setViewport(1440, 900);
	// 音樂 1：16 個八拍、最後一個八拍 1 拍，後面接口號段（「0 秒」緊貼在前一段最後的號碼旁邊）
	await openPracticeFlow(`flow = core.updateSegment(flow, 's1', { eights: 16, lastBeats: 1 }).flow;
		flow = core.addSegment(flow, 'chant').flow;`);
	const seen = {};
	seen.原本 = await rulerOverlaps();
	for (let i = 0; i < 12; i++) await js(`document.querySelector('.timeline [aria-label="時間軸縮小"]').click()`);
	await sleep(200);
	seen.最小 = await rulerOverlaps();
	seen.倍數 = await js(`return document.querySelector('.timeline .zoom-val').textContent`);
	const ok = Object.values(seen).every((v) => typeof v === 'string' || (v.字 > 0 && v.疊到的.length === 0));
	return { ok, value: seen };
});

await check('八拍尺上口號段的「0 秒」只有一行，不斷成兩行（#210）', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow(`flow = core.addSegment(flow, 'chant').flow;`);
	const v = await js(`const s = [...document.querySelectorAll('.timeline .ruler .tk span')].find((s) => s.textContent.trim() === '0 秒');
		if (!s) return null;
		const range = document.createRange(); range.selectNodeContents(s);
		const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
		return { 行數: tops.size, 高: Math.round(s.getBoundingClientRect().height) };`);
	return { ok: !!v && v.行數 === 1, value: v ?? '找不到「0 秒」' };
});

await check('兩張站位只差 2 拍：沒選到、滑鼠沒移上去時 ✕ 不蓋在縮圖上（放滿和 ×1 都是）', async () => {
	await setViewport(1440, 900);
	// libSample 150 BPM：2 拍 0.8 秒
	await openPracticeFlow(`flow = core.insertFormation(flow, 4.8).flow; flow = core.insertFormation(flow, 5.6).flow;`);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
	const covered = () =>
		js(`return [...document.querySelectorAll('.film .th')].flatMap((th, i) => {
			const r = th.getBoundingClientRect();
			const pick = th.querySelector('.pick');
			// 縮圖上的四個點：右上角（✕ 的地方）、中間、左下、右下
			const pts = [[r.right - 6, r.top + 6], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
			return pts.some(([x, y]) => { const el = document.elementFromPoint(x, y); return !el || !pick.contains(el); })
				? ['站位 ' + (i + 1) + '（寬 ' + Math.round(r.width) + '）'] : [];
		});`);
	const seen = { 放滿: await covered() };
	await js(`const z = () => document.querySelector('.timeline .zoom-val').textContent;
		for (let i = 0; i < 20 && z() !== '×1.0'; i++) {
			document.querySelector('.timeline [aria-label="時間軸縮小"]').click();
			await new Promise((r) => setTimeout(r, 50));
		}`);
	await sleep(200);
	seen['×1'] = await covered();
	seen.倍數 = await js(`return document.querySelector('.timeline .zoom-val').textContent`);
	return { ok: seen.放滿.length === 0 && seen['×1'].length === 0 && seen.倍數 === '×1.0', value: seen };
});

await check('滑鼠點過「時間軸縮小」再按真的空白鍵：播放，不會又縮小一次（放開空白鍵不算按下按鈕）', async () => {
	await setViewport(1440, 900);
	await openSample();
	const btn = await js(`const r = document.querySelector('.timeline [aria-label="時間軸縮小"]').getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
	await click(btn.x, btn.y);
	const zoom = () => js(`return document.querySelector('.timeline .zoom-val').textContent`);
	const before = await zoom();
	const focused = await js(`return document.activeElement?.getAttribute('aria-label')`);
	for (const type of ['keyDown', 'keyUp'])
		await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: type === 'keyDown' ? ' ' : undefined });
	await sleep(300);
	const playing = await js(`return !!document.querySelector('button[aria-label="暫停"]')`);
	const after = await zoom();
	await js(`document.querySelector('button[aria-label="暫停"]')?.click()`);
	return { ok: focused === '時間軸縮小' && playing && after === before, value: { 焦點: focused, 播放: playing, 倍數: `${before} → ${after}` } };
});

/** 真的滾輪，按著修飾鍵（CDP modifiers：2 Ctrl、4 ⌘、8 Shift）。 */
const wheelWith = async (x, y, deltaY, modifiers) => {
	await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers });
	await sleep(200);
};
const fieldViewBox = () => js(`return document.querySelector('svg.field').getAttribute('viewBox')`);

await check('場地放大後：滾輪是平移、倍數不變；⌘＋滾輪才縮放', async () => {
	await setViewport(1440, 900);
	await openSample();
	await hitAndClick('.rail button[aria-label="放大"]');
	await hitAndClick('.rail button[aria-label="放大"]');
	const f = await rectOf('svg.field');
	const seen = { 倍數: [await zoomText()], 畫面: [await fieldViewBox()] };
	await wheelWith(f.x, f.y, 120, 0);
	seen.倍數.push(await zoomText());
	seen.畫面.push(await fieldViewBox());
	await wheelWith(f.x, f.y, -120, 4);
	seen.倍數.push(await zoomText());
	const [a, b, c] = seen.倍數;
	return { ok: a === b && seen.畫面[0] !== seen.畫面[1] && c !== b, value: seen };
});

await check('場地放大後拖人到畫面邊上停著：自動捲', async () => {
	await setViewport(1440, 900);
	await openSample();
	for (let i = 0; i < 3; i++) await hitAndClick('.rail button[aria-label="放大"]');
	const p = await js(`const svg = document.querySelector('svg.field').getBoundingClientRect();
		const d = [...document.querySelectorAll('svg.field [data-member-id]')].map((g) => g.getBoundingClientRect())
			.find((r) => r.left > svg.left + 80 && r.right < svg.right - 80 && r.top > svg.top + 80 && r.bottom < svg.bottom - 80);
		return d ? { x: d.left + d.width / 2, y: d.top + d.height / 2, right: svg.right } : null;`);
	if (!p) return { ok: false, value: '放大後畫面裡沒有人' };
	const before = await fieldViewBox();
	await mouse('mousePressed', p.x, p.y);
	await mouse('mouseMoved', p.x + 10, p.y);
	await mouse('mouseMoved', p.right - 4, p.y);
	await sleep(600);
	const after = await fieldViewBox();
	await mouse('mouseReleased', p.right - 4, p.y, 0);
	return { ok: before !== after, value: { 按下時: before, 拖到右邊停一下: after } };
});

await check('左欄捲到底，「版面回原狀」還固定在上面點得到', async () => {
	await setViewport(1440, 1000);
	await openSample();
	await js(`const s = document.querySelector('[aria-label="場地和時間軸的分界"]');
		for (let i = 0; i < 40; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));`);
	await sleep(300);
	const rail = await rectOf('.rail');
	await wheel(rail.x, rail.y, 2000);
	const res = await js(`const rail = document.querySelector('.rail');
		const b = [...rail.querySelectorAll('button')].find((x) => x.textContent.trim() === '版面回原狀');
		if (!b) return { ok: false, value: '沒有「版面回原狀」' };
		const r = b.getBoundingClientRect();
		const rr = rail.getBoundingClientRect();
		const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return { ok: rail.scrollTop > 0 && !!top && b.contains(top) && r.top >= rr.top - 1,
			value: { 左欄捲了: rail.scrollTop, 按鈕: [Math.round(r.top), Math.round(r.bottom)], 左欄: [Math.round(rr.top), Math.round(rr.bottom)], 中心點上面是: top ? top.outerHTML.slice(0, 80) : null } };`);
	// 拖過的高度存在這台電腦，下一條檢查不要受影響
	await js(`document.querySelector('[aria-label="場地和時間軸的分界"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
	return res;
});

// ---------- 選單和小窗不跑出畫面（#141） ----------

/** 中心點最上面的東西是不是它自己（先捲進它所在的小窗裡看得到的地方）。 */
const centersHit = (selector) =>
	js(`return [...document.querySelectorAll(${JSON.stringify(selector)})].map((b) => {
		b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return [b.getAttribute('aria-label') || b.textContent.trim(), !!t && b.contains(t), t ? t.outerHTML.slice(0, 50) : '畫面外']; })
		.filter(([, ok]) => !ok);`);

await check('1180×813、6 個人：最後一個人的任務角色選單整個看得到，「＋自訂任務角色…」點得到', async () => {
	await setViewport(1180, 813);
	const of = `((r) => { if (r.kind !== 'ok') throw new Error(JSON.stringify(r)); return r.flow; })`;
	await openPracticeFlow(`flow = ${of}(core.addMembers(flow, [{ name: '小C', gender: 'M', globalRole: 'base' }, { name: '小D', gender: 'F', globalRole: 'base' }]));
		flow = ${of}(core.addAction(flow, { segmentId: 's1', category: 'stunt', name: '六人', start: 16, length: 16, note: '',
			members: flow.members.map((m) => ({ memberId: m.id, role: null })) }));`);
	await js(`document.querySelector('[data-action-id="x2"]').click()`);
	await waitFor(() => js(`return document.querySelectorAll('.action-form [role=combobox]').length === 6`));
	await js(`[...document.querySelectorAll('.action-form [role=combobox]')].at(-1).classList.add('last-pick')`);
	// 最後一個人捲到右邊欄的各個高度（越下面，選單往下開越容易被裁掉）
	const bad = [];
	for (const k of [0.5, 0.8, 0.95]) {
		await js(`document.activeElement?.blur()`);
		await sleep(100);
		const at = await scrollPanelTo('.last-pick', k);
		const p = await rectOf('.last-pick');
		await click(p.x, p.y);
		const res = await cornersVisible('[role=listbox]');
		const miss = await centersHit('[role=listbox] [role=option]');
		if (!res.ok || miss.length) bad.push({ 選單在右邊欄的: at, ...res.value, 點不到的: miss });
	}
	return { ok: bad.length === 0, value: bad };
});

await check('1024×768 在最上面和最下面的八拍點一拍：拍點小窗整個在畫面裡，每顆按鈕中心點到的是它自己', async () => {
	await setViewport(1024, 768);
	// 三個八拍長的動作 x2：拍點格子有三排
	await openPracticeFlow(`flow = core.addAction(flow, { segmentId: 's1', category: 'jump', name: '長', start: 16, length: 48, note: '',
		members: [{ memberId: 'm1', role: null }] }).flow;`);
	await js(`document.querySelector('[data-action-id="x2"]').click()`);
	await waitFor(() => js(`return document.querySelectorAll('.cues .row').length === 3`));
	await js(`const rows = [...document.querySelectorAll('.cues .row')];
		rows[0].querySelector('.cell:not(:disabled)').classList.add('top-cell');
		[...rows.at(-1).querySelectorAll('.cell:not(:disabled)')].at(-1).classList.add('bottom-cell');`);
	const bad = [];
	for (const cell of ['.top-cell', '.bottom-cell']) {
		for (const k of [0.1, 0.5, 0.9]) {
			await js(`if (document.querySelector('.cues .pop')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
			await sleep(100);
			const at = await scrollPanelTo(cell, k);
			const p = await rectOf(cell);
			await click(p.x, p.y);
			await sleep(200);
			const box = await js(`const r = document.querySelector('.cues .pop').getBoundingClientRect();
				return { ok: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
					小窗: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], 畫面: [innerWidth, innerHeight] };`);
			const miss = await centersHit('.cues .pop button');
			if (!box.ok || miss.length) bad.push({ 點的: cell, 在右邊欄的: at, ...box, 點不到的: miss });
		}
	}
	return { ok: bad.length === 0, value: bad };
});

await check('段設定：BPM 被擋、紅字出現前後，對話框上緣不動（#163）', async () => {
	await setViewport(1440, 1200);
	// 新建一支流程（不用開檔），在最後加一個音樂段：段設定自己打開
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	// 頁面還沒接上（hydrate）時按建立會變成一般的表單送出：沒進編輯畫面就再按一次
	await waitFor(async () => {
		await js(`const name = document.querySelector('.new-flow input[aria-label="流程名字"]');
			if (!name) return;
			name.value = '版面'; name.dispatchEvent(new Event('input', { bubbles: true }));
			document.querySelector('.new-flow button[type=submit]').click();`);
		await sleep(500);
		return js(`return !!document.querySelector('button[aria-label="在最後加一段"]')`);
	});
	await js(`document.querySelector('button[aria-label="在最後加一段"]').click();
		await new Promise((r) => setTimeout(r, 50));
		[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '＋音樂段').click();`);
	await waitFor(() => js(`return !!document.querySelector('.seg-dialog')`));
	await sleep(200);
	const top = () => js(`return Math.round(document.querySelector('.seg-dialog').getBoundingClientRect().top)`);
	const before = await top();
	await js(`const i = [...document.querySelectorAll('.seg-dialog label')].find((l) => l.textContent.trim().startsWith('BPM')).querySelector('input');
		i.value = '999'; i.dispatchEvent(new Event('change', { bubbles: true }));`);
	await sleep(200);
	const alert = await js(`return document.querySelector('.seg-dialog [role=alert]')?.textContent ?? null`);
	const after = await top();
	return { ok: !!alert && before === after, value: { 上緣: `${before} → ${after}`, 紅字: alert } };
});

await check('色條：用 Tab 停在選到的色條上，跟滑鼠點選的樣子不一樣（焦點框是青色外框，不被選取的框蓋掉）', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow();
	const bar = '[data-lane="m1"] [data-action-id="x1"]';
	const look = () =>
		js(`const el = document.querySelector('${bar}'), s = getComputedStyle(el);
			return { 焦點: document.activeElement === el, 看得到焦點: el.matches(':focus-visible'),
				外框: s.outlineStyle === 'none' ? 'none' : s.outlineWidth + ' ' + s.outlineStyle + ' ' + s.outlineColor + ' offset ' + s.outlineOffset,
				陰影: s.boxShadow };`);
	const tab = async (shift) => {
		for (const type of ['keyDown', 'keyUp'])
			await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
		await sleep(150);
	};
	const p = await rectOf(bar);
	await click(p.x, p.y);
	const clicked = await look();
	await tab(false);
	await tab(true);
	const tabbed = await look();
	const ok =
		clicked.焦點 && !clicked.看得到焦點 && tabbed.焦點 && tabbed.看得到焦點 &&
		tabbed.外框 !== clicked.外框 && tabbed.外框.includes('rgb(25, 180, 216)');
	return { ok, value: { 滑鼠點選: clicked, Tab回來: tabbed } };
});

await check('從時間軸左下角的空白處一路拖到上方列：不會把介面上的字反白', async () => {
	await setViewport(1440, 900);
	await openPracticeFlow();
	await js(`getSelection().removeAllRanges()`);
	const from = await js(`const r = document.querySelector('.timeline-host').getBoundingClientRect(); return { x: r.left + 4, y: r.bottom - 4 };`);
	const to = await js(`const r = document.querySelector('.topbar').getBoundingClientRect(); return { x: r.right - 4, y: r.top + 4 };`);
	await mouse('mousePressed', from.x, from.y);
	for (let i = 1; i <= 10; i++) await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
	await mouse('mouseReleased', to.x, to.y, 0);
	await sleep(200);
	const text = await js(`return getSelection().toString()`);
	return { ok: text.trim() === '', value: { 反白的字: text.slice(0, 120) } };
});

// B01：欄位有焦點時畫面把它換掉，頁面不丟例外（丟了會由最後那條共用規則抓到）。
await check('欄位有焦點時畫面把它換掉（首頁名字欄按 Enter 建立、流程設定的名字欄按 Esc 關掉）：畫面照常換過去', async () => {
	await setViewport(1440, 900);
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.new-flow input[aria-label="流程名字"]')`));
	await sleep(300);
	await js(`document.querySelector('.new-flow input[aria-label="流程名字"]').focus()`);
	await send('Input.insertText', { text: '例外測試' });
	await press('Enter');
	const created = await waitFor(() => js(`return !!document.querySelector('.rail')`), 25).catch(() => false);
	await js(`document.querySelector('.topbar button[title="流程設定"]').click()`);
	await sleep(300);
	await js(`document.querySelector('.flow-dialog input[aria-label="流程名字"], .flow-dialog input').focus()`);
	await send('Input.insertText', { text: '2' });
	await press('Escape');
	const closed = await js(`return !document.querySelector('.flow-dialog')`);
	return { ok: created && closed, value: { 建立了: created, 流程設定關掉了: closed } };
});

await check('欄位有焦點時畫面把它換掉（站位名稱有焦點時刪掉這張站位、縮成手機寬）：畫面照常換過去', async () => {
	await setViewport(1440, 900);
	await openSample();
	const before = await js(`return document.querySelectorAll('.row.film .pick').length`);
	await js(`[...document.querySelectorAll('.row.film .pick')][1].click()`);
	await sleep(300);
	await js(`document.querySelector('.formation-name').focus()`);
	await send('Input.insertText', { text: '開場' });
	// 用 click() 不搶焦點：焦點還在名稱欄裡時整張站位被拿掉
	await js(`document.querySelector('[aria-label="刪除站位 2"]').click()`);
	await sleep(300);
	const after = await js(`return document.querySelectorAll('.row.film .pick').length`);
	await js(`[...document.querySelectorAll('.row.film .pick')].at(-1).click()`);
	await sleep(300);
	await js(`document.querySelector('.formation-name').focus()`);
	await send('Input.insertText', { text: '開場' });
	await setViewport(390, 844);
	const phone = await js(`return !!document.querySelector('.phone-view')`);
	await setViewport(1440, 900);
	return { ok: after === before - 1 && phone, value: { 刪之前幾張: before, 刪之後幾張: after, 縮窄後是手機畫面: phone } };
});

/** 有焦點的欄位：值、旁邊的字數（aria-describedby 指到的）、字數的顏色、紅色（--fail）是什麼顏色。 */
const fieldCount = (selector) =>
	js(`const i = document.querySelector(${JSON.stringify(selector)});
		const c = document.getElementById(i.getAttribute('aria-describedby'));
		const probe = document.createElement('i');
		probe.style.color = 'var(--fail)';
		document.body.append(probe);
		const fail = getComputedStyle(probe).color;
		probe.remove();
		return { value: i.value, count: c.textContent, color: getComputedStyle(c).color, fail, chars: [...new Intl.Segmenter().segment(i.value)].length };`);
/** 真的按 Tab 離開欄位。 */
await check('字數上限（B20）：貼上、輸入法打超過上限，停在上限、計數變紅；按 Tab 離開後字還在', async () => {
	await setViewport(1440, 900);
	await openSample();
	await js(`document.querySelector('[data-action-id]').click()`);
	await sleep(300);
	const sel = 'input[aria-label="名稱"]';
	const at = await rectOf(sel);
	await click(at.x, at.y);
	await js(`document.querySelector(${JSON.stringify(sel)}).select()`);
	await send('Input.insertText', { text: '一二三四五六七八九十'.repeat(3) });
	await sleep(200);
	const pasted = await fieldCount(sel);
	await press('Tab');
	const left = await fieldCount(sel);
	await js(`const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.select();`);
	const ime = '字'.repeat(25);
	await send('Input.imeSetComposition', { text: ime, selectionStart: ime.length, selectionEnd: ime.length });
	await send('Input.insertText', { text: ime });
	await sleep(200);
	const composed = await fieldCount(sel);
	await press('Tab');
	const composedLeft = await fieldCount(sel);
	const ok =
		pasted.chars === 20 && pasted.count === '20/20' && pasted.color === pasted.fail &&
		left.chars === 20 && left.count === '20/20' &&
		composed.value === '字'.repeat(20) && composed.count === '20/20' && composedLeft.value === '字'.repeat(20);
	return { ok, value: { 貼上: pasted, 離開後: left, 輸入法: composed, 輸入法離開後: composedLeft } };
});

await check('名字被退回（B28）：流程名字清成空白再離開，字數寫的是欄位裡留下來的字', async () => {
	await setViewport(1440, 900);
	await openSample();
	await js(`document.querySelector('.topbar button[title="流程設定"]').click()`);
	await sleep(300);
	const sel = '.flow-dialog input[aria-label="流程名字"]';
	await js(`const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.select();`);
	await send('Input.insertText', { text: '   ' });
	await press('Tab');
	const after = await fieldCount(sel);
	await press('Escape');
	return { ok: after.value.trim() !== '' && after.count === `${after.chars}/40`, value: after };
});

await check('1440×900 播放頭停在走位條右端（點站位 2）：按住右端往左拖，拖到的是走位條的端點，不是播放頭', async () => {
	await setViewport(1440, 900);
	await openSample();
	await js(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '站位 2' || b.textContent.trim() === '站位 2').click()`);
	await sleep(300);
	const walk = '[data-lane="m1"] [data-walk]';
	const before = await js(`const w = document.querySelector('${walk}'); w.scrollIntoView({ block: 'center', inline: 'center' });
		const r = w.getBoundingClientRect(), ph = document.querySelector('[data-playhead-line]').getBoundingClientRect();
		return { left: r.left, right: r.right, y: r.top + r.height / 2, 播放頭: ph.left + ph.width / 2, 位置: document.querySelector('[aria-label="目前位置"]').textContent };`);
	await sleep(200);
	const x = before.right - 2;
	await mouse('mousePressed', x, before.y);
	for (const dx of [5, 15, 30]) { await mouse('mouseMoved', x - dx, before.y); await sleep(30); }
	await mouse('mouseReleased', x - 30, before.y, 0);
	await sleep(300);
	const after = await js(`const r = document.querySelector('${walk}').getBoundingClientRect();
		return { left: r.left, right: r.right, 位置: document.querySelector('[aria-label="目前位置"]').textContent };`);
	const ok = Math.abs(before.播放頭 - before.right) <= 2 && Math.abs(after.left - before.left) < 1 && after.right < before.right - 10 && after.位置 === before.位置;
	await js(`[...document.querySelectorAll('.topbar button')].find((b) => b.title.startsWith('復原')).click()`);
	return { ok, value: { 拖之前: before, 拖之後: after } };
});

await check('1440×900 40 人：時間軸往下捲到最後的泳道，站位列還在八拍尺下面，縮圖看得到', async () => {
	await setViewport(1440, 900);
	await openBigFlow();
	return js(`const t = document.querySelector('.timeline');
		t.scrollTop = t.scrollHeight;
		await new Promise((r) => setTimeout(r, 200));
		const ruler = document.querySelector('.timeline .ruler-row').getBoundingClientRect();
		const film = document.querySelector('.timeline .row.film').getBoundingClientRect();
		const thumb = document.querySelector('.timeline .row.film .th').getBoundingClientRect();
		const hit = document.elementFromPoint(thumb.left + thumb.width / 2, thumb.top + thumb.height / 2);
		const v = { 捲了: Math.round(t.scrollTop), 八拍尺下緣: Math.round(ruler.bottom), 站位列上緣: Math.round(film.top), 點縮圖點到縮圖: !!hit?.closest('.th') };
		t.scrollTop = 0;
		return { ok: v.捲了 > 0 && Math.abs(v.站位列上緣 - v.八拍尺下緣) <= 1 && v.點縮圖點到縮圖, value: v };`);
});

await check('1440×900 40 人：點場上最後一個人，泳道捲到他那一行（不藏在段列、八拍尺底下，不左右捲）；再點第一個人也是（#215）', async () => {
	await setViewport(1440, 900);
	await openBigFlow();
	const scroller = '.timeline';
	/** 那一行的名字在時間軸看得到的地方（扣掉黏在上面的段列、八拍尺）。 */
	const seen = (id) =>
		js(`const t = document.querySelector('${scroller}'), box = t.getBoundingClientRect();
			const lab = document.querySelector('[data-lane="${id}"] .lab').getBoundingClientRect();
			const head = document.querySelector('.ruler-row').getBoundingClientRect().bottom;
			return { 看得到: lab.top >= head - 1 && lab.bottom <= box.bottom + 1, 名字上緣: Math.round(lab.top), 尺下緣: Math.round(head),
				時間軸下緣: Math.round(box.bottom), 上下捲: Math.round(t.scrollTop), 左右捲: Math.round(t.scrollLeft) };`);
	const ids = await js(`return [...document.querySelectorAll('[data-lane]')].map((r) => r.dataset.lane)`);
	const [first, last] = [ids[0], ids.at(-1)];
	await js(`const t = document.querySelector('${scroller}'); t.scrollTop = 0; t.scrollLeft = 40;`);
	await sleep(200);
	const left = await js(`return Math.round(document.querySelector('${scroller}').scrollLeft)`);
	const tap = async (id) => {
		const p = await rectOf(`.field [data-member-id="${id}"]`);
		await click(p.x, p.y);
	};
	const before = await seen(last);
	await tap(last);
	const toLast = await seen(last);
	await tap(first);
	const toFirst = await seen(first);
	const ok = !before.看得到 && toLast.看得到 && toFirst.看得到 && toLast.左右捲 === left && toFirst.左右捲 === left;
	return { ok, value: { 點之前: before, 點最後一個: toLast, 再點第一個: toFirst } };
});

await check('1440×900 場上選到的人有明顯的框：選取框的線至少 2 px 粗、比圓點大一圈（#215）', async () => {
	await setViewport(1440, 900);
	await openSample();
	const p = await rectOf('.field [data-member-id="m1"]');
	await click(p.x, p.y);
	const m = await js(`const g = document.querySelector('.field [data-member-id="m1"]');
		const ring = g.querySelector('.ring'), dot = g.querySelector('circle.base, circle.top, rect.base, rect.top');
		if (!ring) return { 有框: false };
		const scale = g.getScreenCTM().a * g.querySelector('g').transform.baseVal[0].matrix.a;
		const s = getComputedStyle(ring);
		return { 有框: true, 線粗: +(parseFloat(s.strokeWidth) * scale).toFixed(1), 線色: s.stroke,
			多出來: +((ring.getBoundingClientRect().width - dot.getBoundingClientRect().width) / 2).toFixed(1) };`);
	return { ok: m.有框 && m.線粗 >= 2 && m.多出來 >= 3, value: m };
});

// ---------- 其他小項（#221） ----------

/**
 * 在頁面裡跑：contrast(el) 是 el 的字和它後面的底色的對比（WCAG，1 到 21）。
 * 底色從自己往外找，半透明的一層層疊上去；字的透明度（含外層的 opacity）也算進去。
 */
const CONTRAST_JS = `
	const rgba = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
	const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
	const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
	const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
	const backdrop = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } return layers.reverse().reduce((bg, l) => over(l, bg), [255, 255, 255, 1]); };
	const contrast = (el) => { let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
		const c = rgba(getComputedStyle(el).color); const bg = backdrop(el); return +ratio(over([c[0], c[1], c[2], c[3] * op], bg), bg).toFixed(2); };
	const bgContrast = (a, b) => +ratio(backdrop(a), backdrop(b)).toFixed(2);`;

await check('上方列「重複」「節拍器」開著和關著一眼分得出來：開著的底色跟關著的對比至少 3:1，開著的字也看得清楚（4.5:1）（#221）', async () => {
	await setViewport(1440, 1000);
	await openSample();
	const m = await js(`${CONTRAST_JS}
		const out = {};
		for (const name of ['repeat', 'metronome']) {
			const label = document.querySelector('.toggle.' + name), input = label.querySelector('input');
			const state = () => ({ 底色: getComputedStyle(label).backgroundColor, 字: contrast(label) });
			if (input.checked) input.click();
			const off = state(); const offEl = label.cloneNode(true); label.after(offEl);
			input.click();
			const on = state();
			out[name] = { 關著: off, 開著: on, 開關底色對比: bgContrast(label, offEl) };
			offEl.remove();
			input.click();
		}
		return out;`);
	const ok = Object.values(m).every((t) => t.開關底色對比 >= 3 && t.開著.字 >= 4.5 && t.關著.字 >= 4.5);
	return { ok, value: m };
});

await check('1440×1000 字太淡的地方看得清楚（對比至少 4.5:1）：播放時間的總長、段列的 BPM 和秒數、右邊欄分頁的人數、泳道的號碼圓圈；號碼圓圈至少 20 px（#221）', async () => {
	await setViewport(1440, 1000);
	await openSample();
	const m = await js(`${CONTRAST_JS}
		const pick = { 總長: '.clock i', BPM和秒數: '.seg .meta', 分頁人數: '.tabs .count', 號碼圓圈: '[data-lane] .lab .no' };
		const out = {};
		for (const [k, sel] of Object.entries(pick)) out[k] = [...document.querySelectorAll(sel)].map(contrast);
		out.圓圈大小 = [...document.querySelectorAll('[data-lane] .lab .no')].map((el) => Math.round(el.getBoundingClientRect().height));
		return out;`);
	const { 圓圈大小, ...contrasts } = m;
	const ok = Object.values(contrasts).every((v) => v.length && v.every((x) => x >= 4.5)) && 圓圈大小.every((h) => h >= 20);
	return { ok, value: m };
});

/** 從 Tab 停在 start 上開始，一直按 Tab，記下停在 within 裡的每一格（離開 within 就停）。 */
async function tabStops(start, within) {
	await js(`document.querySelector(${JSON.stringify(start)}).focus()`);
	const stops = [];
	for (let i = 0; i < 40; i++) {
		const s = await js(`const a = document.activeElement; if (!a.closest(${JSON.stringify(within)})) return null;
			const r = a.getBoundingClientRect(); return { 名: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 8), x: Math.round(r.left), y: Math.round(r.top + r.height / 2) };`);
		if (!s) break;
		stops.push(s);
		await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
		await sleep(60);
	}
	return stops;
}

for (const [w, h] of [[1440, 1000], [1920, 1080]]) {
	await check(`${w}×${h} 上方列的 Tab 照畫面順序：由上到下、同一行由左到右（#221）`, async () => {
		await setViewport(w, h);
		await openSample();
		const stops = await tabStops('.topbar .view button', '.topbar');
		// 同一行（中心高度差 20 px 以內）要往右；換行要往下
		const bad = stops.slice(1).filter((s, i) => {
			const p = stops[i];
			return Math.abs(s.y - p.y) <= 20 ? s.x <= p.x : s.y < p.y;
		});
		return { ok: stops.length > 8 && bad.length === 0, value: { 跳回去的: bad, 順序: stops.map((s) => `${s.名}@${s.x},${s.y}`).join(' → ') } };
	});
}

await check('1440×1000 選到的人站在場地後面（上方）時跳提示：提示不蓋住他（#221）', async () => {
	await setViewport(1440, 1000);
	// 小美站在場地正中間最後面（墊子後緣再往後一點，提示預設就在這裡）
	await openPracticeFlow(`flow = core.setPositions(flow, 'f1', { m1: [0, -core.fieldGeometry(flow.field).mat.height / 2 - 0.4] }).flow;`);
	// 先收起「已開啟」的提示（它也在那裡，會擋到滑鼠）
	await js(`document.querySelector('.field-toasts [aria-label="收起提示"]')?.click()`);
	await sleep(200);
	const p = await rectOf('.field [data-member-id="m1"]');
	await click(p.x, p.y);
	// 選到人按 Delete：提示「要刪動作，先點動作」
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
	await sleep(400);
	const m = await js(`const t = document.querySelector('.field-toasts .toast'); if (!t) return { 有提示: false };
		const a = t.getBoundingClientRect(), b = document.querySelector('.field [data-member-id="m1"]').getBoundingClientRect();
		const r = (x) => [Math.round(x.left), Math.round(x.top), Math.round(x.right), Math.round(x.bottom)];
		return { 有提示: true, 提示: r(a), 小美: r(b), 蓋住: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom };`);
	return { ok: m.有提示 && !m.蓋住, value: m };
});

await check('1440×900 場地和時間軸的分界往上拖到底：場地那一塊至少還有 320 px 高（#221）', async () => {
	await setViewport(1440, 900);
	await openSample();
	await js(`const s = document.querySelector('[aria-label="場地和時間軸的分界"]');
		for (let i = 0; i < 60; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));`);
	await sleep(300);
	const hgt = await js(`return Math.round(document.querySelector('main.field-host').getBoundingClientRect().height)`);
	await js(`document.querySelector('[aria-label="場地和時間軸的分界"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
	return { ok: hgt >= 320, value: `場地那一塊 ${hgt} px 高` };
});

// ---------- 撞位 ✕ 在圓點上面、只撞一下的紫段、走位條把手（#216） ----------

await check('1440×1000 小A 騰翻中衝過站著的小B（只撞到一個取樣點）：✕ 在小B 的圓點上面看得到，泳道的紫段至少 8 px 寬', async () => {
	await setViewport(1440, 1000);
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await waitFor(() => js(`return !!window.__svelte && !!document.querySelector('.home-open input[type=file]')`));
	await sleep(300);
	// 小A 從 [-7, 3] 跑到 [7, 3]，3.2 秒經過站在 [0, 3.3] 的小B：只撞到一個取樣點，✕ 畫在 [0, 3.15]，在小B 的圓點裡。
	await js(`const c = await import('/src/lib/core/index.ts');
		const of = (r) => { if (r.kind !== 'ok') throw new Error(JSON.stringify(r)); return r.flow; };
		let flow = of(c.createFlow({ name: '撞一下', field: { strips: 9, layout: 'vertical' } }));
		flow = of(c.addMembers(flow, ['小A', '小B'].map((name) => ({ name, gender: 'F', globalRole: 'base' }))));
		flow = of(c.addSegment(flow, 'music'));
		flow = of(c.setPositions(flow, 'f1', { m1: [-7, 3], m2: [0, 3.3] }));
		flow = of(c.insertFormation(flow, 4.8));
		flow = of(c.setPositions(flow, flow.formations[1].id, { m1: [7, 3] }));
		flow = of(c.addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 0, length: 24, note: '',
			members: [{ memberId: 'm1', role: null }] }));
		const input = document.querySelector('.home-open input[type=file]');
		const dt = new DataTransfer();
		dt.items.add(new File([c.writeFlowFile(flow, {})], '撞一下.zip', { type: 'application/zip' }));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));`);
	await waitFor(() => js(`return !!document.querySelector('.rail')`));
	await sleep(300);
	await js(`[...document.querySelectorAll('.row.film .pick')][1].click()`);
	await sleep(300);
	// ✕ 的中心和四條斜線上各一點（外框的 1/4、3/4）：最上面都是 ✕，不是圓點
	const mark = await js(`const x = document.querySelector('.field [data-clash]');
		if (!x) return { 有: false };
		const r = x.getBoundingClientRect();
		const dot = document.querySelector('.field [data-member-id="m2"]').getBoundingClientRect();
		const 疊在圓點上 = dot.left < r.right && dot.right > r.left && dot.top < r.bottom && dot.bottom > r.top;
		const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]];
		const 被蓋的點 = pts.filter(([fx, fy]) => document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy) !== x);
		return { 有: true, 疊在圓點上, 被蓋的點 };`);
	const seg = await js(`const s = document.querySelector('[data-lane="m1"] [data-walk-clash]');
		if (!s) return { 有: false };
		s.scrollIntoView({ block: 'center', inline: 'center' });
		await new Promise((r) => setTimeout(r, 150));
		const r = s.getBoundingClientRect();
		return { 有: true, 寬: Math.round(r.width * 10) / 10, 看得到: s.checkVisibility() && r.height > 0 };`);
	return {
		ok: mark.有 && mark.疊在圓點上 && mark.被蓋的點.length === 0 && seg.有 && seg.看得到 && seg.寬 >= 8,
		value: { 撞位記號: mark, 紫段: seg }
	};
});

await check('走位條兩端的把手：觸控（1024×768）時每個點得到的範圍都比滑鼠（1440×900）時寬', async () => {
	const ends = () => js(`return [...document.querySelectorAll('[data-walk] [data-end]')].map((e) => Math.round(e.getBoundingClientRect().width * 10) / 10);`);
	await setViewport(1440, 900);
	await openSample();
	const mouseW = await ends();
	await setTouchViewport(1024, 768);
	await openSample();
	const touchW = await ends();
	await clearTouch();
	const narrower = touchW.flatMap((w, i) => (w > mouseW[i] ? [] : [{ 第幾個: i, 滑鼠: mouseW[i], 觸控: w }]));
	return {
		ok: mouseW.length > 0 && touchW.length === mouseW.length && narrower.length === 0,
		value: { 幾個: [mouseW.length, touchW.length], 滑鼠最窄: Math.min(...mouseW), 觸控最窄: Math.min(...touchW), 沒變寬的: narrower.slice(0, 5) }
	};
});

if (pageErrors.length) {
	console.log(`失敗  整個腳本跑完，頁面沒丟過例外`);
	for (const e of pageErrors) console.log(`      在「${e.check}」時：${e.error.replaceAll('\n', '\n        ')}`);
	failed.push('頁面例外');
}
console.log(failed.length ? `\n${failed.length} 條沒過` : '\n全部通過');
stop(failed.length ? 1 : 0);
