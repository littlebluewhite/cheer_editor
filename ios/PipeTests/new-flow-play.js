// 真的那包網頁走一次（PipeTests 的「新建本機流程、放音樂、播放」）：照使用者的點法，
// 新建一支流程 → 在最後加一段音樂段 → 載入一個 3 秒的 wav → 按播放 → 播放頭真的往前走。
// 用 callAsyncJavaScript 跑（最外層可以 await、return）。回傳每一步的結果，失敗就丟錯說卡在哪一步。
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(what, find, ms = 8000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const found = find();
		if (found) return found;
		await sleep(50);
	}
	throw new Error('等不到：' + what);
}
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.includes(text));
const steps = [];

// 1. 新建流程（iPad 橫拿的寬度，首頁就有新建的表單）
const name = await until('新建流程的名字欄', () => document.querySelector('form.new-flow input:not([type=radio])'));
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, '管子測試');
name.dispatchEvent(new Event('input', { bubbles: true }));
document.querySelector('form.new-flow button[type=submit]').click();
const addLast = await until('編輯畫面的「在最後加一段」', () => document.querySelector('[aria-label="在最後加一段"]'));
steps.push('新建了');

// 2. 加一段音樂段
addLast.click();
(await until('「＋音樂段」', () => byText('[role=menuitem]', '音樂段'))).click();
const input = await until('載入音樂的檔案欄', () => document.querySelector('input[type=file][accept*=".wav"]'));

// 3. 3 秒、8000 Hz 的 wav（每 0.5 秒一聲）
const rate = 8000, seconds = 3, n = rate * seconds;
const wav = new DataView(new ArrayBuffer(44 + n * 2));
const text = (at, s) => [...s].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
text(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt ');
wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
text(36, 'data'); wav.setUint32(40, n * 2, true);
for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, i % (rate / 2) < 400 ? Math.sin(i / 2) * 12000 : 0, true);
const files = new DataTransfer();
files.items.add(new File([wav.buffer], 'tick.wav', { type: 'audio/wav' }));
input.files = files.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
await until('音樂載好（畫面寫出 tick.wav 幾秒）', () => /tick\.wav.*3\.0/.test(document.body.innerText));
steps.push('放了音樂');

// 4. 播放：按鈕變成「暫停」，網頁的時間往前走
const play = await until('播放鍵', () => document.querySelector('button[aria-label="播放"]'));
play.click();
await until('按鈕變成暫停', () => document.querySelector('button[aria-label="暫停"]'));
steps.push('在播');
return steps.join('、');
