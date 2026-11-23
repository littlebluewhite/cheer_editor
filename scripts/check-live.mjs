// 部署後看正式站那條路通不通（見 docs/deploy.md「部署完看一次」）：
// 1. 網站的 /health 回 ok。
// 2. 網頁的清單（/web-bundle.json，App 的殼照它更新網頁，ADR 0025）抓得到，清單裡每個檔抓下來大小和 SHA-256 都對得上。
// 3. 自動填密碼用的 /.well-known/apple-app-site-association（#395）是 JSON、跟 repo 裡的 server/apple-app-site-association.json 一樣。
// 4. 音樂的 R2 bucket 准網站的網址 PUT、GET（CORS）。沒設 CORS 時瀏覽器傳音樂會失敗，伺服器的測試看不到（2026-11-20 上線那天就是這樣）。
// 用法：R2_MUSIC_BUCKET_URL=https://<帳號 id>.r2.cloudflarestorage.com/<bucket> npm run check:live
// SITE_URL 預設 https://littlebluewhite.com。不用金鑰：CORS 的 preflight（OPTIONS）不驗簽名。

import { APP_SITE_ASSOCIATION_PATH, checkAppSiteAssociation } from './app-site-association.mjs';
import { checkWebBundle, WEB_BUNDLE_FILE } from './web-bundle.mjs';

const site = (process.env.SITE_URL ?? 'https://littlebluewhite.com').replace(/\/$/, '');
const bucket = process.env.R2_MUSIC_BUCKET_URL?.replace(/\/$/, '');

let failed = false;
function report(ok, what, detail) {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `：${detail}` : ''}`);
	if (!ok) failed = true;
}

try {
	const res = await fetch(`${site}/health`);
	const body = (await res.text()).trim();
	report(res.ok && body === 'ok', `${site}/health`, `${res.status} ${body.slice(0, 80)}`);
} catch (e) {
	report(false, `${site}/health`, String(e));
}

{
	const { files, problems } = await checkWebBundle(site);
	report(problems.length === 0, `${site}/${WEB_BUNDLE_FILE} 和清單裡的 ${files} 個檔`, problems.slice(0, 5).join('；'));
}

{
	const problems = await checkAppSiteAssociation(site);
	report(problems.length === 0, `${site}/${APP_SITE_ASSOCIATION_PATH}`, problems.join('；'));
}

if (!bucket) {
	report(false, '音樂 bucket 的 CORS', '沒設 R2_MUSIC_BUCKET_URL');
} else {
	// 跟瀏覽器傳音樂（PUT 暫放的名字）、播放（GET）時送的 preflight 一樣。物件不用存在。
	for (const [method, headers] of [
		['PUT', 'content-type'],
		['GET', ''],
	]) {
		const what = `${method} ${bucket}/uploading/check-live 的 CORS（Origin: ${site}）`;
		try {
			const res = await fetch(`${bucket}/uploading/check-live`, {
				method: 'OPTIONS',
				headers: {
					Origin: site,
					'Access-Control-Request-Method': method,
					...(headers && { 'Access-Control-Request-Headers': headers }),
				},
			});
			const allowed = res.headers.get('access-control-allow-origin');
			report(res.ok && (allowed === site || allowed === '*'), what, `${res.status}，allow-origin=${allowed}`);
		} catch (e) {
			report(false, what, String(e));
		}
	}
}

if (failed) {
	console.log('\n有沒過的。CORS 的設法見 docs/deploy.md「雲端流程的音樂檔」。');
	process.exit(1);
}
