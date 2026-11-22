// 模擬器上走一次「殼自己從網站更新網頁」（#393）：測試自己在本機起一個小網站（127.0.0.1，不連正式站），
// 放一包新網頁（App 裡那包，index.html 多一個記號），殼抓下來；教練回到首頁後換上，草稿、小設定都還在。
import CryptoKit
import Foundation
import Network
import ShellCore
import Testing
import WebKit
@testable import CheerEditor

/// 本機的小網站：路徑 → 內容；找不到回 200.html（跟正式站一樣）。
final class LocalSite: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "local-site")
    private let files: [String: Data]
    private let redirects: [String: URL]
    private(set) var asked: [String] = []

    /// redirects：這些路徑回 302 轉到別的網址。
    init(files: [String: Data], redirects: [String: URL] = [:]) throws {
        self.files = files
        self.redirects = redirects
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: params)
    }

    /// 開起來，回傳網址（http://127.0.0.1:<port>）。
    func start() async throws -> URL {
        listener.newConnectionHandler = { [weak self] in self?.serve($0) }
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            final class Once: @unchecked Sendable { var resumed = false }  // 只在 queue 上碰
            let once = Once()
            listener.stateUpdateHandler = { state in
                guard !once.resumed else { return }
                switch state {
                case .ready: once.resumed = true; done.resume()
                case .failed(let e): once.resumed = true; done.resume(throwing: e)
                default: break
                }
            }
            listener.start(queue: queue)
        }
        return URL(string: "http://127.0.0.1:\(listener.port!.rawValue)")!
    }

    func stop() { listener.cancel() }

    private func serve(_ c: NWConnection) {
        c.start(queue: queue)
        c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, _ in
            guard let self, let data, let head = String(data: data, encoding: .utf8)?.split(separator: "\r\n").first else { c.cancel(); return }
            let target = head.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
            let path = String((target.removingPercentEncoding ?? target).dropFirst())
            self.asked.append(path)
            if let to = self.redirects[path] {
                let out = Data("HTTP/1.1 302 Found\r\nLocation: \(to.absoluteString)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8)
                c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
                return
            }
            let body = self.files[path] ?? self.files["200.html"] ?? Data()
            var out = Data("HTTP/1.1 200 OK\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
            out.append(body)
            c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
        }
    }
}

/// App 裡那包網頁，index.html 的 <head> 後面多一個記號：清單照 scripts/web-bundle.mjs 的算法重算。
func newerWebBundle(from site: URL) throws -> [String: Data] {
    struct Manifest: Decodable { struct File: Decodable { let path: String }; let files: [File] }
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: site.appendingPathComponent("web-bundle.json")))
    var files: [String: Data] = [:]
    for f in manifest.files { files[f.path] = try Data(contentsOf: site.appendingPathComponent(f.path)) }
    let index = String(decoding: files["index.html"]!, as: UTF8.self)
    files["index.html"] = Data(index.replacingOccurrences(of: "<head>", with: #"<head><meta name="x-web-bundle" content="new">"#).utf8)
    let sha = { (d: Data) in SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }
    let paths = files.keys.sorted()
    let id = sha(Data(paths.map { "\(sha(files[$0]!))  \($0)\n" }.joined().utf8))
    let list = paths.map { JSONValue.object(["path": .string($0), "size": .number(Double(files[$0]!.count)), "sha256": .string(sha(files[$0]!))]) }
    files["web-bundle.json"] = Data(JSONValue.object(["id": .string(id), "files": .array(list)]).jsonString.utf8)
    return files
}

/// 清單（照 scripts/web-bundle.mjs 的算法）。
func manifestJSON(_ files: [String: String]) -> String {
    let sha = { (d: Data) in SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }
    let paths = files.keys.sorted()
    let id = sha(Data(paths.map { "\(sha(Data(files[$0]!.utf8)))  \($0)\n" }.joined().utf8))
    let list = paths.map { JSONValue.object(["path": .string($0), "size": .number(Double(Data(files[$0]!.utf8).count)), "sha256": .string(sha(Data(files[$0]!.utf8)))]) }
    return JSONValue.object(["id": .string(id), "files": .array(list)]).jsonString
}

/// 跟 ShellViewController 一樣接：橋從 ShellParts、自訂網址的路從 SchemeRoutes 來（草稿在殼裡、ReadyPart 接到 WebUpdates），
/// 只是 WebUpdates 先放接本機小網站、下載放暫存資料夾的那個。iPad 橫拿的大小。
@MainActor
final class AppWired {
    let context = ShellContext()
    let updates: WebUpdates
    let shell: WebShell
    private let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1194, height: 834))

    init(site: URL, bundled: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("web-bundles-\(UUID().uuidString)")
        updates = WebUpdates(context: context, site: site, root: root, bundled: bundled, autoCheck: false)
        WebUpdates.byContext[ObjectIdentifier(context)] = updates
        let bridge = Bridge(shellVersion: "9.9.9", shellBuild: 99, parts: ShellParts.all(context))
        shell = WebShell(siteRoot: bundled, bridge: bridge, routes: SchemeRoutes.all(context), openOutside: { _ in })
        context.attach(shell)
        window.addSubview(shell.webView)
        shell.webView.frame = window.bounds
        window.isHidden = false
    }

    func close() { WebUpdates.byContext[ObjectIdentifier(context)] = nil }

    /// 開首頁，等到換成這包網頁、橋也塞好了（剛開始是空白頁，about:blank 也是 complete）。
    func open() async throws {
        shell.webView.load(URLRequest(url: BundledSite.home))
        try await waitUntil("首頁出來") {
            (try? await self.js("return location.href + ' ' + document.readyState + ' ' + !!window.__cheerShell")) as? String == "app://local/ complete true"
        }
    }

    func js(_ body: String, _ args: [String: Any] = [:]) async throws -> Any? {
        try await shell.webView.callAsyncJavaScript(body, arguments: args, contentWorld: .page)
    }

    func waitUntil(_ what: String, seconds: Double = 10, _ check: () async -> Bool) async throws {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if await check() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        Issue.record("等不到：\(what)")
    }
}

extension PipeTests {
    /// 跟 App 一樣接（WebUpdates），只是網站換成本機的小網站、放下載的資料夾換成暫存的。
    @MainActor
    func updatingHarness(site: URL, bundled: URL) -> (Harness, () -> WebUpdates) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("web-bundles-\(UUID().uuidString)")
        var made: WebUpdates?
        let h = Harness(siteRoot: bundled, parts: { context in
            made = WebUpdates(context: context, site: site, root: root, bundled: bundled, autoCheck: false)
            return [made!.part]
        }, routes: { _ in [made!.route] }, size: CGSize(width: 1194, height: 834))
        return (h, { made! })
    }

    @Test func 殼自己更新網頁_回到首頁後換上新的_草稿小設定都還在() async throws {
        let bundled = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let local = try LocalSite(files: newerWebBundle(from: bundled))
        let app = AppWired(site: try await local.start(), bundled: bundled)
        defer { local.stop(); app.close() }
        try await app.open()
        let marker = "return document.querySelector('meta[name=x-web-bundle]') ? 'new' : 'old'"
        #expect(try await app.js(marker) as? String == "old")
        _ = try await app.js("localStorage.setItem('web-update-test', 'kept'); return null")

        // 草稿要在首頁「最近的流程」裡：用開過的流程檔（沒改過，回首頁也留一份）。剛新建沒改的流程，按「新建」回首頁時草稿照規則丟掉（#393 第一版的測試就是走這條，才會紅）。
        // 名字每次不一樣：模擬器是共用的，上次留下的草稿不會讓這個測試假裝過。草稿在殼裡（#377，橋上的 draftList、draftLoad）。
        let name = "換網頁測試-\(UUID().uuidString.prefix(6))"
        let js = """
            const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
            const until = async (what, find) => { for (let i = 0; i < 200; i++) { const f = await find(); if (f) return f; await sleep(50); } throw new Error('等不到：' + what); };
            const byText = (s, t) => [...document.querySelectorAll(s)].find((el) => el.textContent.includes(t));
            const draftIds = async () => (await window.__cheerShell.send('draftList')).map((d) => d.id);
            const toHome = async () => {
              document.querySelector('button[aria-haspopup=dialog]').click();
              (await until('選單的「新建」', () => byText('[role=dialog] button', '新建'))).click();
              await until('首頁', () => document.querySelector('form.new-flow'));
            };
            """
        // 1. 新建一支流程，從殼拿它的草稿（就是流程檔的位元組），回首頁；2. 首頁開這個流程檔（編輯中）
        _ = try await app.js(js + """
            const before = await draftIds();
            const input = await until('新建流程的名字欄', () => document.querySelector('form.new-flow input:not([type=radio])'));
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('form.new-flow button[type=submit]').click();
            await until('編輯畫面', () => document.querySelector('[aria-label="在最後加一段"]'));
            const id = await until('新建的流程存了草稿', async () => (await draftIds()).find((d) => !before.includes(d)));
            const bytes = Uint8Array.fromBase64((await window.__cheerShell.send('draftLoad', { id })).bytes);
            await toHome();
            const files = new DataTransfer();
            files.items.add(new File([bytes], name + '.zip'));
            const open = document.querySelector('label.open input[type=file]');
            open.files = files.files;
            open.dispatchEvent(new Event('change', { bubbles: true }));
            await until('開好流程檔', () => document.querySelector('[aria-label="在最後加一段"]'));
            return null
            """, ["name": name])
        // 編輯中殼抓到新網頁：不換
        await app.updates.part.check()
        #expect(local.asked.contains("web-bundle.json") && local.asked.contains("index.html"))
        try await Task.sleep(for: .seconds(2))
        #expect(try await app.js(marker) as? String == "old", "還在編，不換")
        #expect(app.updates.updater.servingRoot == nil)

        // 回到首頁 → 網頁請殼換上 → 重新載入新的那包
        _ = try await app.js(js + "await toHome(); return null")
        try await app.waitUntil("換上新的那包", seconds: 15) { (try? await app.js(marker)) as? String == "new" }
        try await app.waitUntil("新的那包說好了（ShellParts 的 ReadyPart 接到 WebUpdates）") { !app.updates.updater.waitingForReady }
        #expect(app.updates.updater.servingRoot != nil)
        #expect(try await app.js("return localStorage.getItem('web-update-test')") as? String == "kept")
        // 用 textContent：這裡的 innerText 常常只拿到「使用說明」（原因沒查；元素看得到、有高度）
        try await app.waitUntil("草稿還在：首頁的最近的流程有它") {
            let recent = "return [...document.querySelectorAll('li')].map((li) => li.textContent).join('\\n')"
            return ((try? await app.js(recent)) as? String ?? "").contains(name)
        }
    }

    @Test func 測試裡App自己不去正式站看() {
        #expect(WebUpdates.underTest)
    }

    @Test func 殼自己更新網頁_跟App一樣接_換上的網頁說好了就留著() async throws {
        let bundled = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let local = try LocalSite(files: newerWebBundle(from: bundled))
        let app = AppWired(site: try await local.start(), bundled: bundled)
        defer { local.stop(); app.close() }
        try await app.open()
        let marker = "return document.querySelector('meta[name=x-web-bundle]') ? 'new' : 'old'"
        await app.updates.part.check()
        #expect(try await app.js("return await window.__cheerShell.send('useNewWebBundle')") as? Bool == true)
        try await app.waitUntil("換上新的那包", seconds: 15) { (try? await app.js(marker)) as? String == "new" }
        try await app.waitUntil("新的那包說好了（ShellParts 的 ReadyPart 接到 WebUpdates）") { !app.updates.updater.waitingForReady }
        #expect(app.updates.updater.servingRoot != nil)
    }

    @Test func 殼自己更新網頁_網站轉到別的網站就不跟_整包丟掉() async throws {
        let files = ["index.html": "新的那包"]
        let other = try LocalSite(files: ["index.html": Data("新的那包".utf8)])
        let otherURL = try await other.start()
        defer { other.stop() }
        var served = files.mapValues { Data($0.utf8) }
        served["web-bundle.json"] = Data(manifestJSON(files).utf8)
        let local = try LocalSite(files: served, redirects: ["index.html": otherURL.appendingPathComponent("index.html")])
        let site = try await local.start()
        defer { local.stop() }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("web-update-\(UUID().uuidString)")
        let updater = WebUpdater(site: site, root: tmp.appendingPathComponent("root"), bundled: tmp.appendingPathComponent("none"),
                                 fetch: SiteFetcher(site: site).get, rolledBack: {})
        #expect(await updater.check() == .discarded)
        #expect(local.asked.contains("index.html"))
        #expect(other.asked.isEmpty)
    }

    @Test func 殼自己更新網頁_換上後網頁當掉就退回原本那包() async throws {
        let bundled = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let local = try LocalSite(files: newerWebBundle(from: bundled))
        let site = try await local.start()
        defer { local.stop() }
        let (h, updates) = updatingHarness(site: site, bundled: bundled)
        try await h.load("")
        await updates().part.check()
        #expect(try await h.js("return await window.__cheerShell.send('useNewWebBundle')") as? Bool == true)
        let marker = "return document.querySelector('meta[name=x-web-bundle]') ? 'new' : 'old'"
        try await h.waitUntil("換上新的那包", seconds: 15) { (try? await h.js(marker)) as? String == "new" }
        // 還沒說「好了」前讓網頁的行程當掉（只在測試用 WebKit 內部的方法）
        h.shell.webView.perform(Selector(("_killWebContentProcess")))
        try await h.waitUntil("退回原本那包", seconds: 15) { (try? await h.js(marker)) as? String == "old" }
        #expect(updates().updater.servingRoot == nil)
    }
}
