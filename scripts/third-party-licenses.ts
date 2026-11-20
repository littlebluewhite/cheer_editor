// 建置時產生 third-party-licenses.txt：網站裡打包進去的別人的套件，各自的名字、版本、授權、原始碼在哪、授權全文。
// 例：mediabunny 是 MPL-2.0，要讓使用者知道原始碼在哪裡拿得到；MIT 的套件要附上原作者的版權說明。
// 只看瀏覽器拿到的檔（client），加上 service worker 用的 workbox（它另外建置，看不到打包內容，所以寫死從哪個套件開始找）。
// 找不到授權全文的套件會讓建置失敗，不會悄悄漏掉。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const FILE_NAME = 'third-party-licenses.txt';
const SERVICE_WORKER_ROOTS = ['@vite-pwa/workbox-swkit'];
// 程式產生到 src/ 裡的套件（不在 node_modules 底下，打包內容認不出來）：Paraglide 的 runtime 在 src/lib/paraglide/。
// 只加它自己，它依賴的是建置工具，沒有打包進去。
const GENERATED_INTO_SRC = ['@inlang/paraglide-js'];

export function thirdPartyLicenses(): Plugin {
	return {
		name: 'third-party-licenses',
		apply: 'build',
		generateBundle(_options, bundle) {
			if (this.environment.name !== 'client') return;
			const dirs = new Set<string>();
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== 'chunk') continue;
				for (const id of chunk.moduleIds) {
					const dir = packageDir(id);
					if (dir) dirs.add(dir);
				}
			}
			for (const name of SERVICE_WORKER_ROOTS) addWithDependencies(name, process.cwd(), dirs);
			for (const name of GENERATED_INTO_SRC) dirs.add(findPackageDir(name, process.cwd()));
			this.emitFile({ type: 'asset', fileName: FILE_NAME, source: render([...dirs]) });
		}
	};
}

/** 模組路徑在 node_modules 裡的話，回傳那個套件的資料夾。 */
function packageDir(id: string): string | undefined {
	const path = id.replace(/^\0/, '').split('?')[0];
	const at = path.lastIndexOf('/node_modules/');
	if (at < 0) return undefined;
	const rest = path.slice(at + '/node_modules/'.length).split('/');
	const segments = rest[0].startsWith('@') ? 2 : 1;
	return path.slice(0, at) + '/node_modules/' + rest.slice(0, segments).join('/');
}

function addWithDependencies(name: string, from: string, dirs: Set<string>) {
	const dir = findPackageDir(name, from);
	if (dirs.has(dir)) return;
	dirs.add(dir);
	const deps = Object.keys(readPackage(dir).dependencies ?? {});
	for (const dep of deps) addWithDependencies(dep, dir, dirs);
}

/** 跟 Node 一樣，從 from 往上一層一層找 node_modules/<name>。 */
function findPackageDir(name: string, from: string): string {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) return candidate;
		if (dirname(dir) === dir) throw new Error(`找不到套件 ${name}（從 ${from} 往上找）`);
	}
}

type PackageJson = {
	name: string;
	version: string;
	license?: string;
	repository?: string | { url: string };
	dependencies?: Record<string, string>;
};

function readPackage(dir: string): PackageJson {
	return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function render(dirs: string[]): string {
	const entries = dirs.map((dir) => {
		const pkg = readPackage(dir);
		const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
		if (!licenseFile) throw new Error(`${pkg.name} 找不到授權全文（${dir}）`);
		const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
		return {
			key: `${pkg.name}@${pkg.version}`,
			text: [
				`${pkg.name} ${pkg.version}`,
				`授權：${pkg.license ?? '見下方全文'}`,
				...(repo ? [`原始碼：${repo.replace(/^git\+/, '')}`] : []),
				'',
				readFileSync(join(dir, licenseFile), 'utf8').trim()
			].join('\n')
		};
	});
	const unique = [...new Map(entries.map((e) => [e.key, e])).values()].sort((a, b) =>
		a.key.localeCompare(b.key)
	);
	return [
		'競技啦啦隊流程編輯器用到的第三方套件和授權',
		'這個網站裡包含下面這些別人寫的套件。每個套件照它自己的授權使用，原始碼在各自寫的網址可以拿到。',
		'',
		...unique.map((e) => `${'='.repeat(72)}\n${e.text}\n`)
	].join('\n');
}
