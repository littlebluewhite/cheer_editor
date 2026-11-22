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
    private(set) var asked: [String] = []

    init(files: [String: Data]) throws {
        self.files = files
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: params)
    }

    /// 開起來，回傳網址（http://127.0.0.1:<port>）。
    func start() async throws -> URL {
        listener.newConnectionHandler = { [weak self] in self?.serve($0) }
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            var resumed = false
            listener.stateUpdateHandler = { state in
                guard !resumed else { return }
                switch state {
                case .ready: resumed = true; done.resume()
                case .failed(let e): resumed = true; done.resume(throwing: e)
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
        let site = try await local.start()
        defer { local.stop() }
        let (h, updates) = updatingHarness(site: site, bundled: bundled)
        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        let marker = "return document.querySelector('meta[name=x-web-bundle]') ? 'new' : 'old'"
        #expect(try await h.js(marker) as? String == "old")
        _ = try await h.js("localStorage.setItem('web-update-test', 'kept'); return null")

        // 新建一支本機流程（編輯中），這時殼抓到新網頁
        _ = try await h.js("""
            const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
            let name; while (!(name = document.querySelector('form.new-flow input:not([type=radio])'))) await sleep(50);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, '換網頁測試');
            name.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('form.new-flow button[type=submit]').click();
            while (!document.querySelector('[aria-label="在最後加一段"]')) await sleep(50);
            return null
            """)
        await updates().part.check()
        #expect(local.asked.contains("web-bundle.json") && local.asked.contains("index.html"))
        try await Task.sleep(for: .seconds(2))
        #expect(try await h.js(marker) as? String == "old", "還在編，不換")
        #expect(updates().updater.servingRoot == nil)

        // 回到首頁（選單的「新建」）→ 網頁請殼換上 → 重新載入新的那包
        _ = try await h.js("""
            const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
            const byText = (s, t) => [...document.querySelectorAll(s)].find((el) => el.textContent.includes(t));
            document.querySelector('button[aria-label="選單"]').click();
            let item; while (!(item = byText('[role=dialog] button', '新建'))) await sleep(50);
            item.click();
            return null
            """)
        try await h.waitUntil("換上新的那包", seconds: 15) { (try? await h.js(marker)) as? String == "new" }
        try await h.waitUntil("新的那包說好了") { h.readyCount >= 2 }
        // Harness 的 ReadyPart 只數次數；App 裡 ShellParts.swift 的 ReadyPart 會叫這個
        updates().updater.webSaidReady()
        #expect(updates().updater.servingRoot != nil)
        #expect(try await h.js("return localStorage.getItem('web-update-test')") as? String == "kept")
        try await h.waitUntil("草稿還在：首頁的最近的流程有它") {
            ((try? await h.js("return document.body.innerText")) as? String ?? "").contains("換網頁測試")
        }
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
