// 模擬器上「真的 WKWebView」的管子測試（#375、#341）：開一頁小測試網頁，每條管子走一次。
// iOS 一更新、管子壞了，這裡測得出來。規則本身在 ShellCore 的測試（swift test，不用模擬器）。
import Foundation
import ShellCore
import Testing
import WebKit
@testable import CheerEditor

/// 測試用的一塊：網頁送什麼就回什麼。
struct EchoPart: BridgePart {
    var messages: Set<String> { ["echo"] }
    func handle(name: String, body: JSONValue) async throws -> JSONValue { body }
}

/// 收網頁 POST 上來的內容：回「收到幾個 byte、從哪裡拿到的、內容的 SHA 前幾碼」。
struct ProbeRoute: SchemeRoute {
    func handles(_ request: URLRequest) -> Bool { request.url?.path == "/probe" }
    func respond(to request: URLRequest) async -> (HTTPURLResponse, Data) {
        var data = Data()
        var via = "none"
        if let body = request.httpBody {
            data = body; via = "httpBody"
        } else if let stream = request.httpBodyStream {
            via = "httpBodyStream"
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 64 * 1024)
            while true {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            stream.close()
        }
        let text = "\(via) \(data.count) \(data.prefix(16).map { String(format: "%02x", $0) }.joined())"
        let out = Data(text.utf8)
        return (SchemeHandler.response(request.url!, status: 200, type: "text/plain", length: out.count), out)
    }
}

@MainActor
final class Harness {
    let shell: WebShell
    var openedOutside: [URL] = []
    var readyCount = 0
    let window: UIWindow

    let context = ShellContext()

    /// 跟 App 一樣接：parts、routes 從 ShellContext 建，網頁畫面建好再接上 context。
    init(
        siteRoot: URL,
        parts: (ShellContext) -> [any BridgePart] = { _ in [] },
        routes: (ShellContext) -> [any SchemeRoute] = { _ in [ProbeRoute()] },
        size: CGSize = CGSize(width: 400, height: 800),
        dataStore: WKWebsiteDataStore = .default()
    ) {
        var ready: (() -> Void)?
        let bridge = Bridge(shellVersion: "9.9.9", shellBuild: 99,
                            parts: [ReadyPart(onReady: { ready?() }), EchoPart()] + parts(context))
        var opened: ((URL) -> Void)?
        shell = WebShell(siteRoot: siteRoot, bridge: bridge, routes: routes(context), openOutside: { opened?($0) },
                         dataStore: dataStore)
        context.attach(shell)
        // 放進視窗：不在畫面上的 WKWebView，計時器、畫面更新會被放慢
        window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.addSubview(shell.webView)
        shell.webView.frame = window.bounds
        window.isHidden = false
        ready = { [unowned self] in self.readyCount += 1 }
        opened = { [unowned self] in self.openedOutside.append($0) }
    }

    func load(_ path: String) async throws {
        let url = "app://local/\(path)"
        shell.webView.load(URLRequest(url: URL(string: url)!))
        // 剛開始還是空白頁（about:blank 也是 complete）：要等到換成這一頁
        try await waitUntil("頁面載完") {
            (try? await self.js("return location.href + ' ' + document.readyState")) as? String == "\(url) complete"
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

/// 小測試網頁在測試的 bundle 裡（pipe.html）。
let fixtures = Bundle(for: BundleMarker.self).resourceURL!
final class BundleMarker {}

@MainActor
@Suite(.serialized)
struct PipeTests {
    @Test func documentStart塞的在網頁程式之前就到了() async throws {
        let h = Harness(siteRoot: fixtures)
        try await h.load("pipe.html")
        let boot = try await h.js("return JSON.stringify(window.results.bootAtFirstScript)") as? String
        #expect(boot == #"{"features":[],"shellBuild":99,"shellVersion":"9.9.9"}"#)
    }

    @Test func 網頁送一句殼回一句() async throws {
        let h = Harness(siteRoot: fixtures)
        try await h.load("pipe.html")
        let got = try await h.js("return JSON.stringify(await window.__cheerShell.send('echo', {a: [1, '字']}))") as? String
        #expect(got == #"{"a":[1,"字"]}"#)
        let error = try await h.js("try { await window.__cheerShell.send('noSuchThing'); return 'no error' } catch (e) { return e.message }") as? String
        #expect(error == "unknown")
    }

    @Test func 殼主動說一句網頁收到() async throws {
        let h = Harness(siteRoot: fixtures)
        try await h.load("pipe.html")
        _ = try await h.js("window.heard = []; window.__cheerShell.on('ping', (b) => window.heard.push(b.n)); return null")
        h.context.outbox.emit("ping", ["n": 2])  // 跟 App 裡的一塊一樣，從 ShellContext 的 outbox 說
        try await h.waitUntil("網頁收到 ping") { (try? await h.js("return window.heard.length")) as? Int == 1 }
        #expect(try await h.js("return window.heard[0]") as? Int == 2)
    }

    @Test func 外面的連結交給Safari_畫面留在這包網頁() async throws {
        let h = Harness(siteRoot: fixtures)
        try await h.load("pipe.html")
        _ = try await h.js("location.href = 'https://example.com/'; return null")
        try await h.waitUntil("交給 Safari") { h.openedOutside.count == 1 }
        #expect(h.openedOutside.first?.absoluteString == "https://example.com/")
        #expect(h.shell.webView.url?.absoluteString == "app://local/pipe.html")
    }

    /// 開工先驗（#360）：POST 和上傳的內容進不進得了殼。結論寫在 ios/README.md「POST 進不進得了殼」：
    /// 字串、ArrayBuffer、TypedArray、只有字的 FormData 進得了（httpBody，20 MB 也行）；Blob、File、帶檔案的 FormData 進不了（殼收到的是空的）。
    /// 所以網頁要上傳檔案時先 await file.arrayBuffer() 再送。哪天 WebKit 改了，這裡會紅，記得改 README。
    @Test(arguments: [
        ("字串", "fetch('/probe', {method: 'POST', body: 'hello'})", "httpBody 5"),
        ("ArrayBuffer", "fetch('/probe', {method: 'POST', body: new Uint8Array([1,2,3,4]).buffer})", "httpBody 4"),
        ("20 MB 的 Uint8Array", "fetch('/probe', {method: 'POST', body: new Uint8Array(20 * 1024 * 1024)})", "httpBody 20971520"),
        ("檔案先轉 ArrayBuffer", "fetch('/probe', {method: 'POST', body: await new File([new Uint8Array(3000)], 'a.mp3').arrayBuffer()})", "httpBody 3000"),
        ("Blob", "fetch('/probe', {method: 'POST', body: new Blob([new Uint8Array(1000)])})", "none 0"),
        ("File", "fetch('/probe', {method: 'POST', body: new File([new Uint8Array(1000)], 'a.mp3')})", "none 0"),
        ("FormData 加檔案", "(() => { const f = new FormData(); f.append('music', new File([new Uint8Array(2000)], 'a.mp3')); return fetch('/probe', {method: 'POST', body: f}); })()", "none 0"),
        ("FormData 只有字", "(() => { const f = new FormData(); f.append('a', 'b'); return fetch('/probe', {method: 'POST', body: f}); })()", "httpBody 133"),
        ("XHR 送 Blob", "new Promise((ok) => { const x = new XMLHttpRequest(); x.open('POST', '/probe'); x.onload = () => ok({ text: () => x.responseText }); x.send(new Blob([new Uint8Array(3000)])); })", "none 0"),
    ])
    func POST的內容進不進得了殼(_ name: String, request: String, want: String) async throws {
        let h = Harness(siteRoot: fixtures)
        try await h.load("pipe.html")
        let got = try await h.js("return await (await \(request)).text()") as? String ?? "（沒回）"
        print("POST 進不進得了殼｜\(name)｜\(got)")
        #expect(got.split(separator: " ").prefix(2).joined(separator: " ") == want, "\(name)：\(got)")
    }

    @Test func 真的那包網頁_新建本機流程_放音樂_播放() async throws {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let script = try String(contentsOf: fixtures.appendingPathComponent("new-flow-play.js"), encoding: .utf8)
        // iPad 橫拿的大小（手機是檢視模式，不能新建）
        let h = Harness(siteRoot: site, size: CGSize(width: 1194, height: 834))
        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        #expect(try await h.js(script) as? String == "新建了、放了音樂、在播")
    }

    @Test func 真的那包網頁打得開_也跟殼說好了() async throws {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let h = Harness(siteRoot: site)
        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        #expect(h.readyCount == 1)
        try await h.waitUntil("首頁出來") {
            ((try? await h.js("return document.body.innerText")) as? String ?? "").contains("流程")
        }
    }
}
