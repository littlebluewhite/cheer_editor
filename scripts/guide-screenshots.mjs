// 重拍使用說明裡的畫面截圖：npm run guide:shots
// 自己開 vite dev 和 headless Chrome，照第 5 章「新手試跑」的流程點一次，邊做邊拍。
// 圖存到 src/lib/guide/shots/*.webp，紅框和號碼是拍之前畫上去的。
// Chrome 不在 macOS 預設位置時，用 CHROME=/path/to/chrome 指定。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'src/lib/guide/shots';
const PORT = 4198;
const CDP = 9338;
const W = 1440;
const H = 1000;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'guide-shots-'));
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
await send('Page.navigate', { url: `http://localhost:${PORT}/` });
await waitFor(() => js(`return !!document.querySelector('.home .start form')`));
await js(helpers);

// 1 首頁
await shot('home', [
	[1, `q('.home .start form')`],
	[2, `q('.home-open label.open')`],
	[3, `q('.home-guide')`]
]);

// 2 新建流程，加兩個底層；拍「隊員」分頁時，小美已經打好還沒按
await js(`$set(q('.home .start form input'), '練習'); $btn('建立').click();`);
await waitFor(() => js(`return !!q('form.add')`));
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

// 5 到 4-1 填動作：按「新增動作」之前拍
const t4 = await js(`return $tick('4')`);
await click(t4.l + 2, ruler.y);
await js(`q('#tab-action').click(); await new Promise((x) => setTimeout(x, 50)); $btn('全隊').click();`);
await sleep(200);
await js(`
	const form = q('.action-form');
	$set([...form.querySelectorAll('input')].find((i) => i.placeholder?.startsWith('例如')), 'Lib');
	for (const [who, role] of [['阿明', '主底'], ['阿強', '側底'], ['小美', '上層']]) {
		$set(form.querySelector('select[aria-label="' + who + ' 的任務角色"]'), role, 'change');
	}`);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1400, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await shot(
	'action',
	[
		[1, `q('#tab-action')`],
		[2, `q('.picker')`, { x: 0.5, y: 0 }],
		[3, `[...document.querySelectorAll('.action-form .grid label.wide')]`],
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
	[1, `q('.topbar')`, { x: 0.27, y: 0.5 }],
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
		[5, `q('.timeline-host .ph')`]
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
	[4, `q('.print-sheet .mini')`]
], `[q('.print-sheet .toolbar'), q('.print-sheet .page')]`);

// 9 拍點格子：在 Lib 放 down 2 拍、up 1 拍、下手 4 拍，給上層的 high V 在 4-7，最後選 4-5 到 4-6
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
	await tap($btn('上層', g.querySelector('[aria-label="給誰"]')));
	await tap(cell('4-7')); await tap($btn('high V', g));
	await tap(cell('4-5')); await tap(more());`);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1400, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await js(`q('.cues').scrollIntoView();`);
await sleep(200);
await shot(
	'cues',
	[
		[1, `[...document.querySelectorAll('.cues .cell')]`, { x: 0.5, y: 0 }],
		[2, `[...document.querySelectorAll('.cues .lane-lbl, .cues .slot')]`, { x: 1, y: 0.6 }],
		[3, `q('.cues .whorow')`],
		[4, `q('.cues .selbar')`, { x: 0.6, y: 0.5 }],
		[5, `[...document.querySelectorAll('.cues .kindrow .words')]`, { x: 0, y: 0 }],
		[6, `[...document.querySelectorAll('.cues .kindrow .clear')]`, { x: 1, y: 0 }]
	],
	`q('.cues')`
);

stop(0);
