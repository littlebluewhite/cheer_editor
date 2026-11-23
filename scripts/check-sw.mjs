// 離線（service worker）檢查：npm run check:sw
// check:layout 和元件測試用 vite dev／jsdom，沒有 service worker，看不到這一類錯。這裡先照部署的樣子建置
// （BASE_PATH=/cheer_editor），開 vite preview 和 headless Chrome，等 service worker 接手，再開網站裡真的會用到的網址，
// 看拿到的是不是對的那一頁。曾經壞過：使用說明連結的 guide?from=editor 被 service worker 給了首頁（見 vite.config.ts 的 generateSW）。
// 全部通過時 0 結束；有一條不對就印出來，1 結束。Chrome 不在 macOS 預設位置時，用 CHROME=/path/to/chrome 指定。
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, BASE_PATH: '/cheer_editor' };
if (spawnSync('node_modules/.bin/vite', ['build'], { env, stdio: ['ignore', 'ignore', 'inherit'] }).status !== 0) process.exit(1);

const freePort = () => new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const PORT = await freePort();
const CDP = await freePort();
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { env, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'check-sw-'))}`, 'about:blank'], { stdio: 'ignore' });
const stop = (code) => { chrome.kill(); server.kill(); process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); stop(1); });
process.on('unhandledRejection', (e) => { console.error(e); stop(1); });

async function waitFor(fn, tries = 100) {
	for (let i = 0; i < tries; i++) {
		try { const v = await fn(); if (v) return v; } catch {}
		await sleep(200);
	}
	throw new Error('等太久');
}

const BASE = `http://127.0.0.1:${PORT}/cheer_editor/`;
await waitFor(async () => (await fetch(BASE)).ok);
const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((t) => t.type === 'page'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); });
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

// 先開一次首頁，等 service worker 接手：之後的網址都從它那裡拿
await send('Page.navigate', { url: BASE });
await waitFor(() => js('!!navigator.serviceWorker.controller'));

// [網址, 標題, 頁面要看到的東西]
const cases = [
	['guide?from=editor', '使用說明', 'button.brand'], // 選單、窄螢幕名字欄、初始畫面的「使用說明」：從編輯器來，品牌字是「關掉分頁」的按鈕
	['guide?from=editor#keys', '使用說明', 'button.brand'], // 動作小窗的「全部的快捷鍵」
	['guide', '使用說明', 'a.brand'],
	// 隱私權政策、支援（#372）：離線也打得開。App Store Connect 填的網址後面有斜線：service worker 不能給首頁
	['privacy', '隱私權政策', 'article'],
	['support', '支援', 'article'],
	['privacy/', '隱私權政策', 'article'],
	['support/', '支援', 'article'],
	['?x=1', '競技啦啦隊流程編輯器', 'h1']
];
let failed = 0;
for (const [path, h1, selector] of cases) {
	await send('Page.navigate', { url: 'about:blank' });
	await send('Page.navigate', { url: BASE + path });
	const got = await waitFor(() => js(`document.querySelector(${JSON.stringify(selector)}) && document.querySelector('h1')?.textContent`), 50).catch(() => js(`document.querySelector('h1')?.textContent ?? '(沒有 h1)'`));
	const controlled = await js('!!navigator.serviceWorker.controller');
	const ok = got === h1 && controlled;
	if (!ok) failed++;
	console.log(`${ok ? '✓' : '✗'} ${path}：h1「${got}」${controlled ? '' : '（沒有被 service worker 接手）'}${ok ? '' : `，要「${h1}」和 ${selector}`}`);
}
stop(failed ? 1 : 0);
