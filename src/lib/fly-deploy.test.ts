// 部署到 Fly（#264、#194、docs/deploy.md）：這幾條寫錯了，要等真的推上 main 才會發現，所以先在這裡擋。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root)).toString();
/** 拿掉 `#` 開頭的註解行，只看真的設定。 */
const withoutComments = (text: string) => text.replace(/^\s*#.*\n/gm, '');
const workflow = withoutComments(read('.github/workflows/fly-deploy.yml'));
const flyToml = withoutComments(read('fly.toml'));
const dockerfile = withoutComments(read('Dockerfile'));

/** workflow 裡一個 job 的那一段（到下一個同層的 job 為止）。 */
function job(name: string): string {
	const match = workflow.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)*)`, 'm'));
	expect(match, `workflow 裡沒有 ${name} 這個 job`).not.toBeNull();
	return match![1];
}

/** fly.toml 一個表格（`[x]` 或 `[[x]]`）底下的那幾行。 */
function table(name: string): string {
	const match = flyToml.match(new RegExp(`^\\[{1,2}${name.replace('.', '\\.')}\\]{1,2}\\n((?:[^\\[].*\\n|\\n)*)`, 'm'));
	expect(match, `fly.toml 裡沒有 [${name}]`).not.toBeNull();
	return match![1];
}

// 伺服器讀的環境變數（server/src/config.rs 的 env::var、need）。除了 fly.toml [env] 那幾條不是祕密，
// 其他都是 Fly secrets 裡的金鑰（網站主人設的，見 docs/deploy.md）：不能出現在公開的設定檔裡。
// 從 config.rs 讀，伺服器多讀一個環境變數時這裡自動跟上。
const SERVER_ENV = [...read('server/src/config.rs').matchAll(/(?:env::var|need)\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]);
const NOT_SECRET = ['LISTEN_ADDR', 'SITE_DIR'];
const SECRETS = [...new Set(SERVER_ENV)].filter((name) => !NOT_SECRET.includes(name));

describe('部署到 Fly 的 workflow', () => {
	it('只在推 main 和手動按的時候跑，fork 來的 PR 不會跑', () => {
		const on = workflow.match(/^on:\n((?: {2}.*\n|\n)*)/m)![1];
		expect(on.split('\n').filter((line) => /^ {2}\S/.test(line))).toEqual([
			'  push:',
			'  workflow_dispatch:'
		]);
		expect(on).toContain('branches: [main]');
		expect(workflow).not.toContain('pull_request');
	});

	it('前端和 Rust 的測試都過了才部署，手動按也只部署 main', () => {
		expect(job('frontend')).toContain('run: npm test');
		expect(job('frontend')).toContain('run: npm run check');
		expect(job('server')).toContain('run: cargo test --locked');
		const deploy = job('deploy');
		expect(deploy).toContain('needs: [frontend, server]');
		expect(deploy).toContain("if: github.ref == 'refs/heads/main'");
		// 只要一台：在場的人、全上誰拿著哪幾組只放這台的記憶體（ADR 0012）。flyctl 預設會開兩台。
		expect(deploy).toContain('flyctl deploy --remote-only --ha=false');
	});

	it('只用那把 Fly 部署 token', () => {
		const used = new Set([...workflow.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]));
		expect([...used]).toEqual(['FLY_API_TOKEN']);
		expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
	});
});

describe('fly.toml', () => {
	it('新加坡一台 shared-cpu-1x 512 MB，一直開著', () => {
		expect(flyToml).toMatch(/^app = "littlebluewhite"$/m);
		expect(flyToml).toMatch(/^primary_region = "sin"$/m);
		const vm = table('vm');
		expect(vm).toContain('cpu_kind = "shared"');
		expect(vm).toContain('cpus = 1');
		expect(vm).toContain('memory = "512mb"');
		const http = table('http_service');
		expect(http).toContain('min_machines_running = 1');
		expect(http).toContain('auto_stop_machines = "off"');
	});

	it('部署前跑資料表遷移（失敗就不部署），bluegreen 換機器，健康檢查不碰資料庫', () => {
		const deploy = table('deploy');
		expect(deploy).toContain('release_command = "/app/cheer-server migrate"');
		expect(deploy).toContain('strategy = "bluegreen"');
		// /health 是 server/src/lib.rs 裡不查資料庫的那條。
		expect(table('http_service.checks')).toContain('path = "/health"');
		expect(dockerfile).toMatch(/\/app\/cheer-server/);
	});

	it('伺服器聽外面的 8080、前端放在映像檔裡；金鑰不寫在這裡', () => {
		const env = table('env');
		expect(env).toContain('LISTEN_ADDR = "0.0.0.0:8080"');
		expect(env).toContain('SITE_DIR = "/app/build"');
		expect(table('http_service')).toContain('internal_port = 8080');
		// 讀得到 config.rs 才算數（正規式壞了、檔案搬了不會變成什麼都沒檢查）。
		expect(SECRETS).toEqual(expect.arrayContaining(['DATABASE_URL', 'R2_SECRET_ACCESS_KEY', 'BACKUP_HEARTBEAT_URL']));
		for (const name of NOT_SECRET) expect(SERVER_ENV).toContain(name);
		for (const name of SECRETS) expect(flyToml).not.toMatch(new RegExp(`\\b${name}\\b`));
	});

	it('Ctrl+C 停得下來（伺服器收 SIGINT 才會好好關）', () => {
		expect(flyToml).toMatch(/^kill_signal = "SIGINT"$/m);
	});
});

describe('Dockerfile', () => {
	it('前端建在網址根目錄，不設 BASE_PATH（ADR 0009）', () => {
		expect(dockerfile).not.toContain('BASE_PATH');
		expect(dockerfile).toContain('npm run build');
	});
});
