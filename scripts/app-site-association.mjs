// 自動填密碼用的檔（#395）：部署後的線上檢查（check-live.mjs）看正式站送的跟 repo 裡的
// server/apple-app-site-association.json 一不一樣。找不到的路徑伺服器回 200.html、狀態 200，
// 所以不只看狀態碼：要是 JSON 的檔案類型、不轉址（Apple 不跟著轉址）、內容一樣。

import { readFileSync } from 'node:fs';

export const APP_SITE_ASSOCIATION_PATH = '.well-known/apple-app-site-association';

const inRepo = JSON.parse(readFileSync(new URL('../server/apple-app-site-association.json', import.meta.url), 'utf8'));

/** 檢查 `site` 送的 apple-app-site-association，回有哪些問題（沒問題是空的）。 @param {string} site @returns {Promise<string[]>} */
export async function checkAppSiteAssociation(site) {
	const url = `${site.replace(/\/$/, '')}/${APP_SITE_ASSOCIATION_PATH}`;
	try {
		const res = await fetch(url, { redirect: 'manual' });
		const type = res.headers.get('content-type') ?? '';
		if (res.status !== 200) return [`${url} 回 ${res.status}，要 200、不能轉址`];
		if (type.split(';')[0].trim() !== 'application/json') return [`${url} 的檔案類型是 ${type}，要 application/json`];
		const body = await res.json();
		if (JSON.stringify(body) !== JSON.stringify(inRepo)) return [`${url} 跟 repo 裡的 server/apple-app-site-association.json 不一樣`];
		return [];
	} catch (e) {
		return [`${url} 抓不到或看不懂：${e}`];
	}
}
