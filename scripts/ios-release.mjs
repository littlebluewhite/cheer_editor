// 出版指令（#396，docs/deploy.md「App」）：檢查都過了才建網頁、放進殼、測殼、封存、上傳到 App Store Connect。
// 自己不 commit、不推；送審的按鈕不在這裡（網站主人在 App Store Connect 按）。
//
//   npm run ios:release                  全部，最後上傳（用 Mac 上 Xcode 登入的帳號，不用 API 金鑰）
//   npm run ios:release -- --no-upload   封存完就停（之後可以在 Xcode 的 Organizer 手動上傳）
//
// 順序：先做便宜的檢查（git、凍的情境、上架版只連自己的網站），再建網頁（管子測試要用真的那包），再跑殼的測試，
// 最後封存、上傳。哪一步沒過就停下來講原因，後面的都不做。

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'ios/CheerEditor.xcodeproj';
const SCHEME = 'CheerEditor';
const SCENARIOS = 'bridge-scenarios';

/** 停下來的原因（給人看的）。 */
export class Stop extends Error {}

/**
 * @typedef {(cmd: string, args: string[], opts?: { cwd?: string, show?: boolean }) => string} Shell
 * 跑一個指令，回它印的字；失敗就丟錯。show：讓人看到它印的（建置、測試）。
 */

/**
 * @param {{ root: string, sh: Shell, upload: boolean, log?: (line: string) => void }} o
 */
export async function release({ root, sh, upload, log = console.log }) {
	const git = (/** @type {string[]} */ ...args) => sh('git', args, { cwd: root }).trim();

	log('1/7 git：乾淨的 main，跟 GitHub 上的一樣');
	if (git('status', '--porcelain') !== '') throw new Stop('有沒 commit 的改動。commit 或丟掉再出版（git status 看是哪些）。');
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
	if (branch !== 'main') throw new Stop(`不在 main（現在在 ${branch}）。出版只出 main。`);
	git('fetch', '-q', 'origin', 'main');
	const head = git('rev-parse', 'HEAD');
	const remote = git('rev-parse', 'origin/main');
	if (head !== remote)
		throw new Stop(`跟 GitHub 上的 main 不一樣（這裡 ${head.slice(0, 8)}、GitHub ${remote.slice(0, 8)}）。先推上去或拉下來。`);

	const version = marketingVersion(root);
	log(`2/7 凍的情境：${SCENARIOS}/${version}/ 跟 current/ 一樣`);
	const diff = frozenDiff(root, version);
	if (diff === null)
		throw new Stop(`這一版（${version}）沒有凍的情境：${SCENARIOS}/${version}/。改版本的「App ${version}」commit 要把 current/ 複製一份過去。`);
	if (diff.length > 0)
		throw new Stop(
			`這一版凍的情境（${version}）跟現在的不一樣：${diff.join('、')}。還沒上架就重凍（docs/deploy.md「App」）；上架了就要出新版。`
		);

	log('3/7 上架版只連自己的網站');
	const leaks = devSiteOutsideDebug(root);
	if (leaks.length > 0)
		throw new Stop(`上架版找得到改網址的設定（要包在 #if DEBUG 裡、不能在 #else）：\n${leaks.join('\n')}`);
	const conditions = buildSetting(sh(xcodebuild, ['-showBuildSettings', ...target(root), '-configuration', 'Release']), 'SWIFT_ACTIVE_COMPILATION_CONDITIONS');
	if (conditions.split(/\s+/).includes('DEBUG'))
		throw new Stop(`上架版（Release）也開了 DEBUG（SWIFT_ACTIVE_COMPILATION_CONDITIONS = ${conditions}），改網址的設定會跟著進去。`);

	log('4/7 建網頁、放進殼');
	sh('npm', ['run', 'ios:web'], { cwd: root, show: true });

	log('5/7 殼的測試：規則（swift test）、模擬器上的管子');
	const simulator = newestIPhone(sh('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
	try {
		sh('swift', ['test'], { cwd: join(root, 'ios/ShellCore'), show: true });
		sh(xcodebuild, ['test', ...target(root), '-destination', `platform=iOS Simulator,id=${simulator}`, '-derivedDataPath', join(root, 'ios/.dd')], { show: true });
	} catch (e) {
		throw new Stop(`殼的測試沒過，不出版。（${/** @type {Error} */ (e).message}）`);
	}

	const build = git('rev-list', '--count', 'HEAD');
	const archive = archivePath(version, build);
	log(`6/7 封存：版本 ${version}、建置號 ${build}（main 的 commit 數）→ ${archive}`);
	sh(
		xcodebuild,
		[
			'archive', ...target(root), '-configuration', 'Release', '-destination', 'generic/platform=iOS',
			'-derivedDataPath', join(root, 'ios/.dd'), '-archivePath', archive, '-allowProvisioningUpdates',
			`CURRENT_PROJECT_VERSION=${build}`
		],
		{ show: true }
	);
	const plist = join(archive, 'Products/Applications/CheerEditor.app/Info.plist');
	const archived = sh('plutil', ['-extract', 'CFBundleVersion', 'raw', plist]).trim();
	if (archived !== build) throw new Stop(`封存出來的建置號是 ${archived}，不是 main 的 commit 數 ${build}。不上傳。`);
	if (sh('plutil', ['-extract', 'ITSAppUsesNonExemptEncryption', 'raw', plist]).trim() !== 'false')
		throw new Stop('封存出來的 Info.plist 沒有 ITSAppUsesNonExemptEncryption = NO。不上傳。');

	if (!upload) {
		log(`封存好了，沒上傳（--no-upload）。要上傳：Xcode → Window → Organizer → 這一份 → Distribute App。`);
		return;
	}
	log('7/7 上傳到 App Store Connect（用 Xcode 登入的帳號）');
	sh(
		xcodebuild,
		[
			'-exportArchive', '-archivePath', archive, '-exportOptionsPlist', join(root, 'ios/ExportOptions.plist'),
			'-exportPath', join(root, 'ios/.dd/export'), '-allowProvisioningUpdates'
		],
		{ show: true }
	);
	log(`上傳了 ${version}（${build}）。等 App Store Connect 處理完，TestFlight 內部測試裝到兩台照「每次出新版殼前」那張清單試；送審的按鈕自己按。`);
}

const xcodebuild = 'xcodebuild';

/** @param {string} root */
function target(root) {
	return ['-project', join(root, PROJECT), '-scheme', SCHEME];
}

/** 專案檔的版本（MARKETING_VERSION）；每個 target 要一樣。 @param {string} root */
export function marketingVersion(root) {
	const text = readFileSync(join(root, PROJECT, 'project.pbxproj'), 'utf8');
	const versions = new Set([...text.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim()));
	if (versions.size !== 1) throw new Stop(`專案檔的 MARKETING_VERSION 要剛好一個值，現在是：${[...versions].join('、') || '沒有'}`);
	return [...versions][0];
}

/**
 * 凍的情境跟 current/ 哪幾個檔不一樣（多、少、內容不同）；沒有這個資料夾回 null。
 * @param {string} root
 * @param {string} version
 */
export function frozenDiff(root, version) {
	const dir = (/** @type {string} */ name) => join(root, SCENARIOS, name);
	let frozen;
	try {
		frozen = readdirSync(dir(version)).sort();
	} catch {
		return null;
	}
	const current = readdirSync(dir('current')).sort();
	return [...new Set([...frozen, ...current])].sort().filter((name) => {
		if (!frozen.includes(name) || !current.includes(name)) return true;
		return readFileSync(join(dir(version), name), 'utf8') !== readFileSync(join(dir('current'), name), 'utf8');
	});
}

/**
 * 殼的程式（ios/App、ios/ShellCore/Sources）裡，改網址的設定（環境變數 "CHEER_…"）不在 #if DEBUG 那一半的每一行。
 * 回「檔案:行：那一行」。
 * @param {string} root
 */
export function devSiteOutsideDebug(root) {
	/** @type {string[]} */
	const found = [];
	for (const base of ['ios/App', 'ios/ShellCore/Sources']) {
		for (const file of swiftFiles(join(root, base))) {
			/** @type {boolean[]} 每一層 #if：這一段是不是 DEBUG 那一半 */
			const stack = [];
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					const t = line.trim();
					if (t.startsWith('#if')) stack.push(/^#if\s+DEBUG\b/.test(t));
					else if (t.startsWith('#elseif') || t.startsWith('#else')) stack[stack.length - 1] = false;
					else if (t.startsWith('#endif')) stack.pop();
					else if (/"CHEER_\w*"/.test(line) && !stack.includes(true))
						found.push(`${relative(root, file)}:${i + 1}：${t}`);
				});
		}
	}
	return found;
}

/** @param {string} dir @returns {string[]} */
function swiftFiles(dir) {
	try {
		return readdirSync(dir, { recursive: true, encoding: 'utf8' })
			.filter((f) => f.endsWith('.swift'))
			.map((f) => join(dir, f));
	} catch {
		return [];
	}
}

/** xcodebuild -showBuildSettings 印的某一項（第一個）。 @param {string} text @param {string} name */
function buildSetting(text, name) {
	return text.match(new RegExp(`^\\s*${name} = (.*)$`, 'm'))?.[1].trim() ?? '';
}

/** 最新的 iOS 上的第一台 iPhone 模擬器（simctl list --json）。 @param {string} json */
export function newestIPhone(json) {
	/** @type {{ devices: Record<string, { name: string, udid: string, isAvailable: boolean }[]> }} */
	const { devices } = JSON.parse(json);
	const ios = Object.keys(devices)
		.filter((r) => r.includes('.iOS-'))
		.map((r) => ({ r, v: r.split('.iOS-')[1].split('-').map(Number) }))
		.sort((a, b) => b.v[0] - a.v[0] || (b.v[1] ?? 0) - (a.v[1] ?? 0));
	for (const { r } of ios) {
		const phone = devices[r].find((d) => d.isAvailable && d.name.startsWith('iPhone'));
		if (phone) return phone.udid;
	}
	throw new Stop('找不到 iPhone 模擬器（xcrun simctl list devices available）。在 Xcode → Settings → Components 裝一個 iOS 模擬器。');
}

/** 放在 Xcode 預設的封存資料夾，Organizer 看得到（上傳不行時在那裡手動按）。 @param {string} version @param {string} build */
function archivePath(version, build) {
	const day = new Date().toISOString().slice(0, 10);
	return join(homedir(), 'Library/Developer/Xcode/Archives', day, `CheerEditor ${version} (${build}).xcarchive`);
}

/** @type {Shell} */
function run(cmd, args, { cwd, show = false } = {}) {
	const r = spawnSync(cmd, args, {
		cwd,
		encoding: 'utf8',
		stdio: show ? 'inherit' : ['ignore', 'pipe', 'inherit'],
		env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' },
		maxBuffer: 64 * 1024 * 1024
	});
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} 失敗（${r.status}）`);
	return r.stdout ?? '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	release({ root, sh: run, upload: !process.argv.includes('--no-upload') }).catch((e) => {
		console.error(e instanceof Stop ? `\n停下來了：${e.message}` : e);
		process.exit(1);
	});
}
