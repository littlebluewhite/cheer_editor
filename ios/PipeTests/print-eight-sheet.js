// 真的那包網頁（PipeTests 的列印，#391）：首頁「開啟流程檔」打開範例流程（docs/samples/sample-flow.zip，
// 參數 zip 是它的 base64）→ 工具列的「八拍表」→ 記下 beforeprint、afterprint → 按「列印」。回傳八拍表上的提示。
// 用 callAsyncJavaScript 跑（最外層可以 await、return）。
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(what, find, ms = 15000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const found = find();
		if (found) return found;
		await sleep(50);
	}
	throw new Error('等不到：' + what);
}

const input = await until('開啟流程檔', () => document.querySelector('.home-open input[type=file]'));
const bytes = Uint8Array.from(atob(zip), (c) => c.charCodeAt(0));
const files = new DataTransfer();
files.items.add(new File([bytes], 'sample-flow.zip', { type: 'application/zip' }));
input.files = files.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
(await until('工具列的「八拍表」', () => document.querySelector('button[title="八拍表"]'))).click();
const sheet = await until('八拍表', () => document.querySelector('.print-sheet'));
await until('八拍表有列', () => sheet.querySelectorAll('tbody tr').length > 0);
window.printEvents = [];
for (const type of ['beforeprint', 'afterprint']) addEventListener(type, () => window.printEvents.push(type));
const hint = sheet.querySelector('.toolbar .muted')?.textContent ?? '';
[...sheet.querySelectorAll('button')].find((b) => b.textContent.trim() === '列印').click();
return hint;
