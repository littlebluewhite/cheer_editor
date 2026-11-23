// 出版指令（scripts/ios-release.mjs，#396）：git、凍的情境、上架版只連自己的網站，都過了才建、測、封存、上傳。
// git 用真的（暫存資料夾裡的 repo，origin 是本機的 bare repo，當成 GitHub）；npm、swift、xcodebuild 換成假的。
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { devSiteOutsideDebug, release } from '../../scripts/ios-release.mjs';

const SIMULATORS = JSON.stringify({
	devices: {
		'com.apple.CoreSimulator.SimRuntime.iOS-18-1': [{ name: 'iPhone 16', udid: 'OLD', isAvailable: true }],
		'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [
			{ name: 'iPad Pro 11-inch (M5)', udid: 'IPAD', isAvailable: true },
			{ name: 'iPhone 17', udid: 'NEW', isAvailable: true }
		]
	}
});

const SITE_SWIFT = `enum AppSite {
    static let current: URL = {
        #if DEBUG
        return SiteAddress.pick(debug: true, override: ProcessInfo.processInfo.environment["CHEER_SITE_URL"])
        #else
        return SiteAddress.production
        #endif
    }()
}
`;

function git(dir: string, ...args: string[]) {
	return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
		cwd: dir,
		encoding: 'utf8'
	}).trim();
}

function write(dir: string, files: Record<string, string>) {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
}

/** 乾淨的 main，跟 origin（當成 GitHub）一樣；3 個 commit；1.0 凍的情境跟現在的一樣。 */
function repo() {
	const base = mkdtempSync(join(tmpdir(), 'ios-release-'));
	const origin = join(base, 'origin.git');
	const root = join(base, 'work');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	execFileSync('git', ['clone', '-q', origin, root]);
	git(root, 'checkout', '-q', '-b', 'main');
	write(root, { 'ios/CheerEditor.xcodeproj/project.pbxproj': 'MARKETING_VERSION = 1.0;\nMARKETING_VERSION = 1.0;\n' });
	git(root, 'add', '.');
	git(root, 'commit', '-q', '-m', '一');
	write(root, {
		'bridge-scenarios/current/ready.json': '{"scenarios":[]}\n',
		'bridge-scenarios/1.0/ready.json': '{"scenarios":[]}\n'
	});
	git(root, 'add', '.');
	git(root, 'commit', '-q', '-m', '二');
	write(root, { 'ios/App/Shell/Site.swift': SITE_SWIFT });
	git(root, 'add', '.');
	git(root, 'commit', '-q', '-m', '三');
	git(root, 'push', '-q', 'origin', 'main');
	return root;
}

/** 假的 npm、swift、xcodebuild、xcrun、plutil；git 照真的跑。fail 裡的指令回失敗。 */
function fakeShell(root: string, { fail = [] as string[], releaseConditions = '', bundleVersion = '' } = {}) {
	const calls: string[] = [];
	const sh = (cmd: string, args: string[]) => {
		if (cmd === 'git') return git(root, ...args);
		const line = [cmd, ...args].join(' ');
		calls.push(line);
		if (fail.some((f) => line.startsWith(f))) throw new Error(`${line} 失敗`);
		if (line.startsWith('xcodebuild -showBuildSettings'))
			return `Build settings for action build and target CheerEditor:\n    SWIFT_ACTIVE_COMPILATION_CONDITIONS = ${releaseConditions}\n`;
		if (line.startsWith('xcrun simctl list')) return SIMULATORS;
		if (line.startsWith('plutil') && line.includes('CFBundleVersion')) return bundleVersion || '3';
		if (line.startsWith('plutil') && line.includes('ITSAppUsesNonExemptEncryption')) return 'false';
		return '';
	};
	return { sh, calls };
}

async function stopsWith(root: string, shell: ReturnType<typeof fakeShell>, reason: RegExp) {
	await expect(release({ root, sh: shell.sh, upload: true, log: () => {} })).rejects.toThrow(reason);
	expect(shell.calls.filter((c) => c.startsWith('xcodebuild archive') || c.includes('-exportArchive'))).toEqual([]);
}

describe('出版指令', () => {
	it('這個 repo 的殼：改網址的設定都在 #if DEBUG 裡', () => {
		expect(devSiteOutsideDebug('.')).toEqual([]);
	});

	it('有沒 commit 的改動：停下來', async () => {
		const root = repo();
		write(root, { 'note.txt': '還沒 commit' });
		await stopsWith(root, fakeShell(root), /沒 commit 的改動/);
	});

	it('不在 main：停下來', async () => {
		const root = repo();
		git(root, 'checkout', '-q', '-b', 'try');
		await stopsWith(root, fakeShell(root), /不在 main/);
	});

	it('跟 GitHub 上的 main 不一樣：停下來', async () => {
		const root = repo();
		git(root, 'commit', '-q', '--allow-empty', '-m', '還沒推');
		await stopsWith(root, fakeShell(root), /跟 GitHub 上的 main 不一樣/);
	});

	it('這一版凍的情境跟現在的不一樣：停下來', async () => {
		const root = repo();
		write(root, { 'bridge-scenarios/current/ready.json': '{"scenarios":[{"name":"新的"}]}\n' });
		git(root, 'commit', '-q', '-am', '改了情境沒重凍');
		git(root, 'push', '-q', 'origin', 'main');
		await stopsWith(root, fakeShell(root), /凍的情境.*1\.0.*不一樣/);
	});

	it('這一版沒有凍的情境：停下來', async () => {
		const root = repo();
		write(root, {
			'ios/CheerEditor.xcodeproj/project.pbxproj': 'MARKETING_VERSION = 1.1;\nMARKETING_VERSION = 1.1;\n'
		});
		git(root, 'commit', '-q', '-am', 'App 1.1 忘了凍');
		git(root, 'push', '-q', 'origin', 'main');
		await stopsWith(root, fakeShell(root), /沒有凍的情境.*bridge-scenarios\/1\.1/);
	});

	it('改網址的設定（CHEER_…）在 #if DEBUG 外面：停下來，講哪個檔哪一行', async () => {
		const root = repo();
		write(root, {
			'ios/App/Update/Leak.swift': 'let site = ProcessInfo.processInfo.environment["CHEER_WEB_BUNDLE_URL"]\n'
		});
		git(root, 'add', '.');
		git(root, 'commit', '-q', '-m', '忘了包 DEBUG');
		git(root, 'push', '-q', 'origin', 'main');
		await stopsWith(root, fakeShell(root), /ios\/App\/Update\/Leak\.swift:1.*CHEER_WEB_BUNDLE_URL/);
	});

	it('#else 那一半（上架版）有改網址的設定：停下來', async () => {
		const root = repo();
		write(root, {
			'ios/App/Shell/Site.swift': SITE_SWIFT.replace(
				'return SiteAddress.production',
				'return URL(string: ProcessInfo.processInfo.environment["CHEER_SITE_URL"]!)!'
			)
		});
		git(root, 'commit', '-q', '-am', '上架版也讀');
		git(root, 'push', '-q', 'origin', 'main');
		await stopsWith(root, fakeShell(root), /Site\.swift:6.*CHEER_SITE_URL/);
	});

	it('上架版（Release）也開了 DEBUG：停下來', async () => {
		const root = repo();
		await stopsWith(root, fakeShell(root, { releaseConditions: 'DEBUG' }), /Release.*DEBUG/);
	});

	it('殼的規則測試紅：停下來，不封存', async () => {
		const root = repo();
		await stopsWith(root, fakeShell(root, { fail: ['swift test'] }), /殼的測試沒過/);
	});

	it('模擬器上的管子測試紅：停下來，不封存', async () => {
		const root = repo();
		await stopsWith(root, fakeShell(root, { fail: ['xcodebuild test'] }), /殼的測試沒過/);
	});

	it('封存出來的建置號跟 main 的 commit 數對不上：停下來，不上傳', async () => {
		const root = repo();
		const shell = fakeShell(root, { bundleVersion: '1' });
		await expect(release({ root, sh: shell.sh, upload: true, log: () => {} })).rejects.toThrow(/建置號/);
		expect(shell.calls.filter((c) => c.includes('-exportArchive'))).toEqual([]);
	});

	it('都過了：建網頁、測殼（最新 iOS 的 iPhone 模擬器）、封存（建置號 = main 的 commit 數）、上傳', async () => {
		const root = repo();
		const shell = fakeShell(root);
		await release({ root, sh: shell.sh, upload: true, log: () => {} });
		const order = ['npm run ios:web', 'swift test', 'xcodebuild test', 'xcodebuild archive', 'xcodebuild -exportArchive'];
		const at = order.map((o) => shell.calls.findIndex((c) => c.startsWith(o)));
		expect(at.every((i) => i >= 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
		expect(shell.calls.find((c) => c.startsWith('xcodebuild test'))).toContain('id=NEW');
		expect(shell.calls.find((c) => c.startsWith('xcodebuild archive'))).toContain('CURRENT_PROJECT_VERSION=3');
	});

	it('--no-upload：封存完就停，不上傳', async () => {
		const root = repo();
		const shell = fakeShell(root);
		await release({ root, sh: shell.sh, upload: false, log: () => {} });
		expect(shell.calls.some((c) => c.startsWith('xcodebuild archive'))).toBe(true);
		expect(shell.calls.some((c) => c.includes('-exportArchive'))).toBe(false);
	});
});
