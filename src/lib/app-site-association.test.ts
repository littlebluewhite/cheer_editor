// 部署後的線上檢查多查自動填密碼用的檔（#395，scripts/app-site-association.mjs）。
import { readFileSync } from 'node:fs';
import { createServer, type OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_SITE_ASSOCIATION_PATH, checkAppSiteAssociation } from '../../scripts/app-site-association.mjs';

const PATH = `/${APP_SITE_ASSOCIATION_PATH}`;
const inRepo = readFileSync(new URL('../../server/apple-app-site-association.json', import.meta.url), 'utf8');

describe('部署後的線上檢查：apple-app-site-association 抓得到、檔案類型對', () => {
	const servers: ReturnType<typeof createServer>[] = [];
	afterEach(() => {
		for (const s of servers.splice(0)) s.close();
	});

	/** 這條路徑回 `status`、`headers`、`body`；其他路徑跟正式站一樣回 200.html、狀態 200。 */
	async function serve(status: number, headers: OutgoingHttpHeaders, body: string): Promise<string> {
		const server = createServer((req, res) => {
			if (req.url === PATH) res.writeHead(status, headers).end(body);
			else res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>入口</h1>');
		});
		servers.push(server);
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	}

	it('跟 repo 裡的檔一樣、是 JSON：沒有問題', async () => {
		const site = await serve(200, { 'content-type': 'application/json' }, inRepo);
		expect(await checkAppSiteAssociation(site)).toEqual([]);
	});

	it('伺服器沒這條路由，拿到 200.html、狀態 200：檢查不會被騙過', async () => {
		const site = await serve(200, { 'content-type': 'text/html' }, '<h1>入口</h1>');
		expect(await checkAppSiteAssociation(site)).toHaveLength(1);
	});

	it('內容對、檔案類型不是 JSON：檢查不過', async () => {
		const site = await serve(200, { 'content-type': 'application/octet-stream' }, inRepo);
		const problems = await checkAppSiteAssociation(site);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('application/octet-stream');
	});

	it('轉址到別的地方：檢查不過（Apple 不跟著轉址）', async () => {
		const site = await serve(301, { location: '/elsewhere' }, '');
		const problems = await checkAppSiteAssociation(site);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('301');
	});

	it('是 JSON、內容跟 repo 裡的不一樣（例：舊的 Team ID）：檢查不過', async () => {
		const other = JSON.stringify({ webcredentials: { apps: ['AAAAAAAAAA.com.littlebluewhite.cheereditor'] } });
		const site = await serve(200, { 'content-type': 'application/json' }, other);
		expect(await checkAppSiteAssociation(site)).toHaveLength(1);
	});
});
