// 重拍使用說明裡的畫面截圖：npm run guide:shots
// 自己開 vite dev 和 headless Chrome，照第 5 章「新手試跑」的流程點一次，邊做邊拍。
// 圖存到 src/lib/guide/shots/*.webp，紅框和號碼是拍之前畫上去的。
// Chrome 不在 macOS 預設位置時，用 CHROME=/path/to/chrome 指定。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'src/lib/guide/shots';
/** 跟作業系統要一個現在沒人用的埠（好幾個 agent 同時跑也不會撞到別人的 vite 或 Chrome）。 */
function freePort() {
	return new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
}
const PORT = await freePort();
const CDP = await freePort();
const W = 1440;
const H = 1000;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'guide-shots-'));
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
const click = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0); await sleep(200); };
async function drag(x1, y1, x2, y2, { release = true } = {}) {
	await mouse('mousePressed', x1, y1);
	for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8);
	if (release) await mouse('mouseReleased', x2, y2, 0);
	await sleep(250);
}

// 頁面裡用的小工具
const helpers = `
	window.q = (s) => document.querySelector(s);
	window.$btn = (name, root = document) => [...root.querySelectorAll('button, [role=tab], a, label')].find((b) => b.textContent.trim() === name);
	window.$set = (el, v, ev = 'input') => { el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
	window.$rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height }; };
	window.$dot = (name) => $rect([...document.querySelectorAll('g[data-member-id]')].find((g) => g.getAttribute('aria-label') === name));
	window.$tick = (label) => $rect([...document.querySelectorAll('[data-ruler] .tk.big')].find((t) => t.textContent.trim() === label));
	window.$label = (text) => [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(text));
`;

/**
 * 畫紅框加號碼，拍照，再拿掉。
 * marks：[號碼, 元素的 JS 運算式（可以是陣列，框住全部）, 號碼放哪（框的比例，預設右上角 {x:1,y:0}）]。
 * clip：只拍這一塊（JS 運算式，可以是陣列，取全部的外框），不給就拍整個畫面。
 */
async function shot(name, marks, clip) {
	const box = await js(`
		const pad = 4;
		const union = (els) => {
			const rs = [].concat(els).filter(Boolean).map((e) => e.getBoundingClientRect());
			const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
			return { l, t, w: Math.max(...rs.map((r) => r.right)) - l, h: Math.max(...rs.map((r) => r.bottom)) - t };
		};
		const clip = ${clip ? `union(${clip})` : `{ l: 0, t: 0, w: innerWidth, h: innerHeight }`};
		const layer = document.createElement('div');
		layer.id = 'shot-layer';
		layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
		for (const [n, expr, at = { x: 1, y: 0 }] of ${JSON.stringify(marks)}) {
			const els = [].concat(eval(expr)).filter(Boolean);
			if (!els.length) throw new Error('找不到要框的東西：' + expr);
			const rs = els.map((e) => e.getBoundingClientRect());
			const l = Math.max(Math.min(...rs.map((r) => r.left)) - pad, clip.l + 2);
			const t = Math.max(Math.min(...rs.map((r) => r.top)) - pad, clip.t + 2);
			const r = Math.min(Math.max(...rs.map((r) => r.right)) + pad, clip.l + clip.w - 2);
			const b = Math.min(Math.max(...rs.map((r) => r.bottom)) + pad, clip.t + clip.h - 2);
			const frame = document.createElement('div');
			frame.style.cssText = 'position:fixed;border:3px solid #e5197e;border-radius:8px;box-shadow:0 0 0 2px #fff';
			Object.assign(frame.style, { left: l + 'px', top: t + 'px', width: r - l + 'px', height: b - t + 'px' });
			const badge = document.createElement('div');
			badge.textContent = n;
			badge.style.cssText = 'position:fixed;width:26px;height:26px;border-radius:50%;background:#e5197e;color:#fff;font:700 15px/26px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff';
			const cx = Math.min(Math.max(l + at.x * (r - l), clip.l + 15), clip.l + clip.w - 15);
			const cy = Math.min(Math.max(t + at.y * (b - t), clip.t + 15), clip.t + clip.h - 15);
			Object.assign(badge.style, { left: cx - 13 + 'px', top: cy - 13 + 'px' });
			layer.append(frame, badge);
		}
		document.body.append(layer);
		return clip;
	`);
	await sleep(100);
	const r = await send('Page.captureScreenshot', {
		format: 'webp',
		quality: 82,
		clip: { x: box.l, y: box.t, width: box.w, height: box.h, scale: 1 }
	});
	writeFileSync(join(OUT, `${name}.webp`), Buffer.from(r.data, 'base64'));
	await js(`document.getElementById('shot-layer').remove()`);
	console.log(`${name}.webp  ${Math.round(box.w)}×${Math.round(box.h)}`);
}

/** 30 秒的假音樂：150 BPM，第一拍在 0.48 秒，每拍一聲鼓，每個八拍的 1 比較大聲。 */
function makeMusic(path) {
	const rate = 22050, sec = 30, bpm = 150, first = 0.48;
	const n = rate * sec;
	const data = Buffer.alloc(44 + n * 2);
	data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
	data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
	data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
	data.write('data', 36); data.writeUInt32LE(n * 2, 40);
	const beat = 60 / bpm;
	for (let i = 0; i < n; i++) {
		const t = i / rate;
		let v = 0.06 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t));
		if (t >= first) {
			const k = Math.floor((t - first) / beat);
			const dt = t - first - k * beat;
			const loud = k % 8 === 0 ? 0.9 : 0.55;
			v += loud * Math.exp(-dt * 18) * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-dt * 30)) * dt);
		}
		data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, 44 + i * 2);
	}
	writeFileSync(path, data);
}

// ---------- 開始拍 ----------
mkdirSync(OUT, { recursive: true });
await send('Page.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await waitFor(() => js(`return !!document.querySelector('.home .start form')`));
// 畫面先由伺服器畫好，Svelte 接手之前按「建立」會變成一般的表單送出；等 Svelte 載入再開始點。
await waitFor(() => js(`return !!window.__svelte`));
await sleep(500);
await js(helpers);

// 1 首頁
await shot('home', [
	[1, `q('.home .start form')`],
	[2, `q('.home-open label.open')`],
	[3, `q('.home-guide')`]
]);

// 2 新建流程，加兩個底層；拍「隊員」分頁時，小美已經打好還沒按
// 第一次開 vite dev 時，它整理好套件會重新載入頁面，按鈕可能還沒接上：沒進到編輯畫面就再按一次。
await waitFor(async () => {
	await js(helpers);
	await js(`$set(q('.home .start form input'), '練習'); $btn('建立').click();`);
	await sleep(500);
	return js(`return !!q('form.add')`);
});
const addMembers = (names, gender, role) =>
	js(`
		const f = q('form.add');
		$set(f.querySelector('textarea'), ${JSON.stringify(names)});
		const [g, r] = f.querySelectorAll('select');
		$set(g, '${gender}', 'change'); $set(r, '${role}', 'change');
		await new Promise((x) => setTimeout(x, 50));`);
await addMembers('阿明\n阿強', 'M', 'base');
await js(`q('form.add button[type=submit]').click();`);
await sleep(300);
await addMembers('小美', 'F', 'top');
await shot(
	'members',
	[
		[1, `q('form.add label.names')`],
		[2, `q('form.add .pair')`],
		[3, `q('form.add button[type=submit]')`],
		[4, `q('.members ol')`]
	],
	`[q('.inspector .tabs'), q('form.add')]`
);
await js(`q('form.add button[type=submit]').click();`);
await sleep(300);

// 3 加音樂段、載入音樂檔
const music = join(tmp, '練習音樂.wav');
makeMusic(music);
await js(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '在最後加一段').click(); await new Promise((x) => setTimeout(x, 50)); $btn('＋音樂段').click();`);
await waitFor(() => js(`return !!q('.seg-dialog')`));
const input = await send('Runtime.evaluate', { expression: `document.querySelector('.seg-dialog label.file input')` });
await send('DOM.setFileInputFiles', { files: [music], objectId: input.result.objectId });
await waitFor(() => js(`return (q('.seg-dialog .peaks')?.getAttribute('d') ?? '').length > 100`));
await js(`$set($label('第一拍（秒）').querySelector('input'), '0.48', 'change')`);
await sleep(300);
await shot(
	'segment',
	[
		[1, `q('.seg-dialog label.file')`],
		[2, `$label('BPM')`],
		[3, `$label('第一拍（秒）')`],
		[4, `q('.seg-dialog .wave')`],
		[5, `q('.seg-dialog .listen')`],
		[6, `[$label('八拍數'), $label('最後一個八拍有幾拍')]`]
	],
	`q('.seg-dialog')`
);
await js(`q('.seg-dialog button[aria-label="關閉"]').click();`);
await sleep(300);

// 4 開頭站位（1-1），再到 3-1 拖小美：拖到一半拍
const ruler = await js(`return $rect(q('[data-ruler]'))`);
await click(ruler.l + 2, ruler.y);
const field = await js(`return $rect(q('svg[aria-label="場地"]'))`);
for (const [name, dx, dy] of [['阿明', -60, 0], ['阿強', 60, 0], ['小美', 0, -40]]) {
	const d = await js(`return $dot('${name}')`);
	await drag(d.x, d.y, field.x + dx, field.y + dy);
}
const t3 = await js(`return $tick('3')`);
await click(t3.l + 2, ruler.y);
{
	const d = await js(`return $dot('小美')`);
	await drag(d.x, d.y, d.x + 4, d.y + 90, { release: false });
	await shot(
		'drag',
		[
			[1, `[...document.querySelectorAll('g[data-member-id]')].find((g) => g.getAttribute('aria-label') === '小美')`],
			[2, `q('.readout')`]
		],
		`q('.field-host')`
	);
	await mouse('mouseReleased', d.x + 4, d.y + 90, 0);
	await sleep(300);
}

// 4.5 挪站位：點第 2 張小圖，在左邊欄「站位時間」打 2-1。播放頭停在站位 2，拍場地和左邊欄（看得到影子和走位線）。
await js(`[...document.querySelectorAll('.row.film .pick')][1].click()`);
await waitFor(() => js(`return !!q('.formation-time input')`));
await js(`$set(q('.formation-time input'), '2-1')`);
await waitFor(() => js(`return q('.pos .pos-at')?.textContent.trim() === '2-1'`));
await js(`q('button[aria-label="收起提示"]')?.click();`);
await sleep(200);
await shot(
	'rail',
	[
		[1, `q('.rail .tools')`],
		[2, `q('.now-formation')`],
		[3, `q('.rail .warn')`],
		[4, `q('.match-prev')`],
		[5, `q('.here')`],
		[6, `q('.walk-tools')`],
		[7, `q('.rail .legend')`],
		// 只框小美：她的走位線，和線上那個影子（另外兩人沒動，影子在自己的點底下）
		[8, `(() => {
			const lines = [...document.querySelectorAll('.walk-line')];
			const r = lines[0].getBoundingClientRect();
			const near = (g) => { const b = g.getBoundingClientRect(); return b.right > r.left - 2 && b.left < r.right + 2; };
			return [...lines, ...[...document.querySelectorAll('[data-ghost]')].filter(near)];
		})()`]
	],
	`q('.field-host')`
);

// 5 到 4-1 填動作：按「新增動作」之前拍
const t4 = await js(`return $tick('4')`);
await click(t4.l + 2, ruler.y);
await js(`q('#tab-action').click(); await new Promise((x) => setTimeout(x, 50)); $btn('全隊').click();`);
await sleep(200);
await js(`
	const form = q('.action-form');
	$set(form.querySelector('header .title'), 'Lib');
	for (const [who, role] of [['阿明', '主底'], ['阿強', '側底'], ['小美', '上層']]) {
		form.querySelector('[role="combobox"][aria-label="' + who + ' 的任務角色"]').click();
		await new Promise((x) => setTimeout(x, 50));
		[...form.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim().startsWith(role)).click();
		await new Promise((x) => setTimeout(x, 50));
	}`);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1400, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await shot(
	'action',
	[
		[1, `q('#tab-action')`],
		[2, `q('.picker')`, { x: 0.5, y: 0 }],
		[3, `[q('.action-form header .title'), ...document.querySelectorAll('.action-form .grid .wide')]`],
		[4, `[...document.querySelectorAll('.action-form .grid .field')]`],
		[5, `q('.action-form .people')`, { x: 0.5, y: 0 }],
		[6, `q('.action-form button.add')`]
	],
	`[q('.inspector .tabs'), q('.action-form')]`
);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await js(`q('.action-form button.add').click();`);
await sleep(300);
await js(`q('button[aria-label="收起提示"]')?.click();`);
await sleep(200);

// 6 整個編輯畫面
await shot('editor', [
	[1, `q('.topbar')`, { x: 0.185, y: 0.5 }],
	[2, `q('.field-host')`, { x: 0, y: 0 }],
	[3, `q('.inspector')`, { x: 0, y: 0 }],
	[4, `q('.timeline-host')`]
]);

// 7 時間軸
await shot(
	'timeline',
	[
		[1, `q('.row.segs')`, { x: 1, y: 0.5 }],
		[2, `q('.row.ruler-row')`, { x: 1, y: 0.5 }],
		[3, `q('.row.film')`, { x: 1, y: 0.5 }],
		[4, `[...document.querySelectorAll('[data-lane]')]`, { x: 1, y: 0.5 }],
		[5, `q('.timeline-host .ph')`],
		[6, `q('.walk[data-walk]')`, { x: 0, y: 1 }]
	],
	`[q('.row.segs'), ...document.querySelectorAll('[data-lane]')]`
);

// 8 八拍表
await js(`$btn('八拍表').click();`);
await waitFor(() => js(`return !!q('.print-sheet .action')`));
await shot('print', [
	[1, `$label('印誰')`, { x: 0.5, y: 1 }],
	[2, `$btn('列印', q('.print-sheet'))`, { x: 0.5, y: 1 }],
	[3, `q('.print-sheet .action')`],
	// 連圖下面那行「站位 1・第 1 拍」一起框（說明寫的是圖和它下面的字）
	[4, `q('.print-sheet figure')`]
], `[q('.print-sheet .toolbar'), q('.print-sheet .page')]`);

// 9 拍點格子：在 Lib 放 down 2 拍、up 1 拍、下手 4 拍，給上層的 high V 在 4-7，最後選 4-5 到 4-6，拍點小窗開著
await js(`$btn('關閉', q('.print-sheet')).click();`);
await waitFor(() => js(`return !!q('.cues .sheet')`));
await js(`
	const g = q('.cues');
	const tap = async (el) => { el.click(); await new Promise((x) => setTimeout(x, 50)); };
	const cell = (n) => g.querySelector('.cell[aria-label="' + n + '"]');
	const more = () => g.querySelector('[aria-label="多選一拍"]');
	await tap(cell('4-1')); await tap(more()); await tap($btn('down', g));
	await tap($btn('up', g));
	await tap(cell('4-1')); for (let i = 0; i < 3; i++) await tap(more()); await tap($btn('下手', g));
	const who = g.querySelector('.pop select');
	who.value = String([...who.options].findIndex((o) => o.textContent === '上層'));
	who.dispatchEvent(new Event('change', { bubbles: true }));
	await tap(cell('4-7')); await tap($btn('high V', g));
`);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1400, deviceScaleFactor: 2, mobile: false });
await sleep(300);
// 先捲好再選 4-5 到 4-6：拍點小窗照捲好的畫面決定放在格子上面還是下面。
await js(`const panel = q('.cues').closest('.panel'); panel.scrollTop = panel.scrollHeight; await new Promise((x) => setTimeout(x, 100));
	q('.cues .cell[aria-label="4-5"]').click(); await new Promise((x) => setTimeout(x, 50));
	q('.cues [aria-label="多選一拍"]').click();`);
await sleep(200);
await shot(
	'cues',
	[
		[1, `[...document.querySelectorAll('.cues .cell')]`, { x: 0.55, y: 1 }],
		[2, `[...document.querySelectorAll('.cues .lane-lbl, .cues .slot')]`, { x: 1, y: 0.6 }],
		[3, `q('.cues .pop')`, { x: 0, y: 0.9 }],
		[4, `[q('.cues .sel-text'), ...document.querySelectorAll('.cues .pm')]`, { x: 0, y: 1 }],
		[5, `q('.cues .who-sel')`, { x: 0.5, y: 0 }],
		[6, `[...document.querySelectorAll('.cues .pop-row .words')]`, { x: 0, y: 0 }],
		[7, `[...document.querySelectorAll('.cues .pop-row .clear')]`, { x: 1, y: 1 }]
	],
	`[q('.cues .pop'), q('.cues .sheet')]`
);

// 10 成功率：多加三個人，在 Lib 的拍點格子加三個環節（4-1 到 4-4 上法「延伸」、4-5 到 4-6 中段、4-7 到 4-8 下法），
// 全部的人先在第 1 組；在場上選後加的三個人，放進新的一組（第 2 組）
const esc = `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((x) => setTimeout(x, 100));`;
await js(esc);
await js(`q('#tab-members').click();`);
await waitFor(() => js(`return !!q('form.add')`));
await addMembers('阿華\n阿偉', 'M', 'base');
await js(`q('form.add button[type=submit]').click();`);
await sleep(300);
await addMembers('小芳', 'F', 'top');
await js(`q('form.add button[type=submit]').click();`);
await sleep(300);
await js(`q('#tab-action').click();`);
await waitFor(() => js(`return !!q('.action-form select[aria-label="加人"]')`));
await js(`
	const wait = () => new Promise((x) => setTimeout(x, 80));
	const form = q('.action-form');
	for (const [who, role] of [['阿華', '主底'], ['阿偉', '側底'], ['小芳', '上層']]) {
		const add = form.querySelector('select[aria-label="加人"]');
		$set(add, [...add.options].find((o) => o.textContent === who).value);
		await wait();
		form.querySelector('[role="combobox"][aria-label="' + who + ' 的任務角色"]').click();
		await wait();
		[...form.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim().startsWith(role)).click();
		await wait();
	}
	const g = q('.cues');
	for (const [from, more, kind, name] of [['4-1', 3, '上法', '延伸'], ['4-5', 1, '中段', ''], ['4-7', 1, '下法', '']]) {
		g.querySelector('.cell[aria-label="' + from + '"]').click(); await wait();
		for (let i = 0; i < more; i++) { g.querySelector('[aria-label="多選一拍"]').click(); await wait(); }
		const k = g.querySelector('select[aria-label="環節的種類"]');
		$set(k, [...k.options].find((o) => o.textContent === kind).value, 'change');
		$set(g.querySelector('input[aria-label="環節的名字"]'), name);
		g.querySelector('[aria-label="加入環節"]').click(); await wait();
	}
`);
await js(esc);
// 後加的三個人擠在場地外面：到開頭那張站位，拖到第 1 組後面（版面變過，位置重新量），再回到 4-1
{
	const r = await js(`return $rect(q('[data-ruler]'))`);
	await click(r.l + 2, r.y);
	const f = await js(`return $rect(q('svg[aria-label="場地"]'))`);
	for (const [name, dx, dy] of [['小芳', 0, 70], ['阿偉', 60, 110], ['阿華', -60, 110]]) {
		const d = await js(`return $dot('${name}')`);
		await drag(d.x, d.y, f.x + dx, f.y + dy);
	}
	const t = await js(`return $tick('4')`);
	await click(t.l + 2, r.y);
	await js(`q('button[aria-label="收起提示"]')?.click();`);
}
// 場上選阿華、阿偉、小芳（點泳道上的名字，Shift 加選），按「＋」放進新的一組
await js(`
	const wait = () => new Promise((x) => setTimeout(x, 80));
	const lab = (who) => [...document.querySelectorAll('[data-lane] button.lab')].find((b) => b.querySelector('.name')?.textContent.trim() === who);
	for (const [i, who] of ['阿華', '阿偉', '小芳'].entries()) {
		lab(who).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: i > 0 })); await wait();
	}
	q('.squad-bar [aria-label="放進新的一組"]').click(); await wait();
`);
await sleep(300);
await shot(
	'squads',
	[
		[6, `[...document.querySelectorAll('svg[aria-label="場地"] .badge')]`],
		[7, `q('.squad-bar .who')`, { x: 0, y: 0 }],
		[8, `[...document.querySelectorAll('.squad-bar .num:not(.new):not(.out)')]`, { x: 0.5, y: 0 }],
		[9, `[q('.squad-bar .num.new'), q('.squad-bar .num.out')]`]
	],
	`q('.field-host')`
);
// 點環節那一條上的「上法 延伸」：選到它的拍，拍點小窗的環節列多出改環節
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1400, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await js(`const panel = q('.cues').closest('.panel'); panel.scrollTop = panel.scrollHeight; await new Promise((x) => setTimeout(x, 100));
	q('.cues .item.phase[aria-label^="環節 上法 延伸"]').click(); await new Promise((x) => setTimeout(x, 100));`);
await sleep(200);
await shot(
	'rate',
	[
		[1, `[q('.cues .lane-lbl.phase'), ...document.querySelectorAll('.cues .item.phase')]`, { x: 1, y: 0.5 }],
		[2, `[...document.querySelectorAll('.cues .pop [aria-label^="把這幾拍標給"]')]`, { x: 0, y: 0 }],
		[3, `[...document.querySelectorAll('.cues .pop [aria-label="環節的種類"], .cues .pop [aria-label="環節的名字"], .cues .pop [aria-label="加入環節"]')]`, { x: 0, y: 0.5 }],
		[4, `q('.cues .pop [aria-label="清掉環節"]')`, { x: 1, y: 0 }],
		[5, `q('.cues .pop .edit')`, { x: 1, y: 1 }]
	],
	`[q('.cues .pop'), q('.cues .sheet')]`
);
await js(esc);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await sleep(300);

// 11 記錄頁：昨天和今天各記幾次（第 2 組今天還有一次只練下法）
await js(`$btn('練習').click();`);
await waitFor(() => js(`return !!q('.practice .card')`));
await js(`
	const wait = () => new Promise((x) => setTimeout(x, 60));
	const day = (back) => { const d = new Date(); d.setDate(d.getDate() - back); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
	const date = q('.practice input[type=date]');
	const NAMES = { '✓': '成功', '△': '小失誤', '✗': '失敗' };
	const PHASES = ['上法 延伸', '中段', '下法'];
	const tap = async (card, marks) => {
		for (const [i, m] of [...marks].entries()) {
			q('button[aria-label="' + card + ' ' + PHASES[i] + ' ' + NAMES[m] + '"]').click();
			await wait();
		}
		// 「整個」要按「存這一次」才存
		[...document.querySelectorAll('.practice .card')].find((c) => c.getAttribute('aria-label') === card).querySelector('.save').click();
		await wait();
	};
	const one = '第 1 組 小美', two = '第 2 組 小芳';
	$set(date, day(1)); await wait();
	for (const m of ['✓✓✓', '✓✗', '✓✓△']) await tap(one, m);
	for (const m of ['✗', '✓△✓', '✓✓✓']) await tap(two, m);
	$set(date, day(0)); await wait();
	for (const m of ['✓✓✓', '✓✓✓', '✓△✓', '✓✓✗']) await tap(one, m);
	for (const m of ['✓✗', '✓✓✓', '✗']) await tap(two, m);
	const card = [...document.querySelectorAll('.practice .card')].find((c) => c.getAttribute('aria-label') === two);
	card.querySelectorAll('.scope input')[1].click(); await wait();
	[...card.querySelectorAll('.phase-name')].find((l) => l.textContent.trim() === '下法').querySelector('input').click(); await wait();
	q('button[aria-label="' + two + ' 下法 成功"]').click(); await wait();
`);
await sleep(300);
await shot('record', [
	[1, `q('.topbar .view')`],
	[2, `[q('.practice .pages'), q('.practice .date')]`],
	[3, `q('.record .list')`],
	[4, `q('.practice .card')`],
	[5, `q('.practice .card footer')`, { x: 1, y: 1 }],
	[6, `q('.practice .daily')`]
], `[q('.topbar'), q('.practice .daily')]`);

// 12 總表：記一次全上（第 1 組中段 △），看最近 7 天，打開第 2 組下法的明細
await js(`$btn('總表').click();`);
await waitFor(() => js(`return !!q('.summary .filters')`));
await js(`
	const wait = () => new Promise((x) => setTimeout(x, 80));
	$btn('＋ 記一次全上').click(); await wait();
	q('button[aria-label="第 1 組 小美 中段 成功"]').click(); await wait();
	$btn('存這次全上').click(); await wait();
	$btn('最近 7 天').click(); await wait();
	[...document.querySelectorAll('.summary .cell')].find((b) => b.getAttribute('aria-label').startsWith('第 2 組 小芳 下法')).click(); await wait();
`);
// 表只有一個動作：畫面矮一點，下面才不會一大片空白（明細貼著右邊、跟畫面一樣高）
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 640, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await shot('summary', [
	[1, `[...document.querySelectorAll('.summary .filters .seg')]`],
	[2, `q('.summary .filters button.primary')`],
	[3, `[...document.querySelectorAll('.summary .cell')].find((b) => b.getAttribute('aria-label').startsWith('第 2 組 小芳 下法')).closest('td')`],
	[4, `[...document.querySelectorAll('.summary td.total')]`, { x: 1, y: 1 }],
	[5, `q('.summary tr.whole')`, { x: 0, y: 1 }],
	[6, `q('aside.detail')`, { x: 0, y: 0 }]
]);

stop(0);
