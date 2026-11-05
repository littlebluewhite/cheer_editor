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
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
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
	await waitFor(() => js(`return !!document.querySelector('.rail')`));
	await sleep(300);
}

/**
 * 開首頁，打開一份 40 人的流程：音樂 1（4 個八拍），x1 全隊跳躍（環節「整個」整個動作，可以記全上），
 * 上面一個很長的步驟拍點（量八拍表印出來有沒有被截斷）。
 */
async function openBigFlow() {
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

for (const w of [1141, 1200, 1300]) {
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
		return { ok: covered && buttons.length === 3 && buttons.every((b) => b.點得到 && b.在畫面裡), value: { 場地被蓋住: covered, buttons } };`);

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
		// 左邊清單挑第一個有卡的動作，第一張卡的第一個環節點「失敗」，再按「存這一次」：存成一次
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
await check('390×844（觸控）：隊員開了流程檔，按提示上的「看八拍表」看得到八拍表，選得了印誰、關得掉', async () => {
	await setTouchViewport(390, 844);
	await openPracticeFlow();
	const hint = await narrowHint();
	if (!hint.ok) return hint;
	const go = await js(`const b = [...document.querySelectorAll('.narrow-hint button')].find((b) => b.textContent.trim() === '看八拍表');
		if (!b) return null;
		const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
	if (!go) return { ok: false, value: '提示上沒有「看八拍表」' };
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
				const hit = dots.some((d) => d.left < r.right && d.right > r.left && d.top < r.bottom && d.bottom > r.top);
				return hit ? [t.textContent] : [];
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

await check('390×844（手機）使用說明：名詞表上下排，不用左右滑', async () => {
	await setTouchViewport(390, 844);
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/guide` });
	await waitFor(() => js(`return !!document.querySelector('#words table')`));
	await sleep(300);
	const r = await js(`const wraps = [...document.querySelectorAll('.table-wrap')].map((w) => ({
			表: w.querySelector('th')?.textContent, 內容寬: w.scrollWidth, 框寬: w.clientWidth }));
		return { 要滑的表: wraps.filter((w) => w.內容寬 > w.框寬 + 1), 頁寬: document.scrollingElement.scrollWidth, 畫面寬: innerWidth };`);
	await clearTouch();
	return { ok: r.要滑的表.length === 0 && r.頁寬 <= r.畫面寬, value: r };
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

console.log(failed.length ? `\n${failed.length} 條沒過` : '\n全部通過');
stop(failed.length ? 1 : 0);
