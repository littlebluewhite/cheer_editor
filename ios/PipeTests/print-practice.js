// 真的那包網頁（PipeTests 的列印，#391）：打開一支有可以記成功率的動作的流程（practice-flow.zip，參數 zip 是 base64；
// src/lib/test-flows.ts 的 libSample() 寫成的流程檔）→ 練習 →「總表」按「列印」(step 'summary')，
// 或再按「＋ 記一次全上」在記一次全上表按「列印」(step 'runThrough')。用 callAsyncJavaScript 跑。
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
const button = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

if (step === 'summary') {
	const input = await until('開啟流程檔', () => document.querySelector('.home-open input[type=file]'));
	const bytes = Uint8Array.from(atob(zip), (c) => c.charCodeAt(0));
	const files = new DataTransfer();
	files.items.add(new File([bytes], 'practice-flow.zip', { type: 'application/zip' }));
	input.files = files.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	(await until('「練習」', () => button('練習'))).click();
	(await until('「總表」', () => button('總表'))).click();
	const summary = await until('總表', () => document.querySelector('.summary .filters'));
	button('列印', summary).click();
} else {
	(await until('「＋ 記一次全上」', () => button('＋ 記一次全上'))).click();
	const footer = await until('記一次全上表', () => button('列印')?.closest('footer'));
	button('列印', footer).click();
}
return 'ok';
