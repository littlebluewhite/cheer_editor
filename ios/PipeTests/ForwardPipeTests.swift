// 殼代網頁上網（#380）的管子：真的 WKWebView 用 fetch('/api/…')，真的 ForwardRoute（URLSession）轉到
// 測試自己在模擬器裡開的小伺服器（127.0.0.1，不連正式網站）。規則本身在 ShellCore 的 ForwarderTests。
import Foundation
import Network
import ShellCore
import Testing
import WebKit
@testable import CheerEditor

/// 模擬器裡的小 HTTP 伺服器：學伺服器的登入、登出（Set-Cookie 跟 server/src/accounts.rs 一樣），/api/me 回它收到的標頭。
final class TinySite: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "tiny-site")
    private(set) var port: UInt16 = 0
    private var started = false
    var url: URL { URL(string: "http://127.0.0.1:\(port)/")! }

    init() async throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] c in
            guard let self else { return }
            c.start(queue: self.queue)
            self.read(c, Data())
        }
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            listener.stateUpdateHandler = { [weak self] state in
                guard let self, !self.started else { return }
                switch state {
                case .ready: self.started = true; self.port = self.listener.port?.rawValue ?? 0; done.resume()
                case .failed(let e): self.started = true; done.resume(throwing: e)
                default: break
                }
            }
            listener.start(queue: queue)
        }
    }

    deinit { listener.cancel() }

    private func read(_ c: NWConnection, _ got: Data) {
        // 這一條連線處理完以前伺服器要在（測試結束才放掉）
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [self] data, _, end, _ in
            let all = got + (data ?? Data())
            guard let split = all.range(of: Data("\r\n\r\n".utf8)) else {
                if !end { self.read(c, all) } else { c.cancel() }
                return
            }
            let head = String(decoding: all[..<split.lowerBound], as: UTF8.self)
            let lines = head.components(separatedBy: "\r\n")
            var headers: [String: String] = [:]
            for line in lines.dropFirst() {
                if let i = line.firstIndex(of: ":") {
                    headers[line[..<i].lowercased()] = line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)
                }
            }
            let length = Int(headers["content-length"] ?? "0") ?? 0
            let body = all[split.upperBound...]
            if body.count < length, !end { self.read(c, all); return }
            let parts = lines[0].split(separator: " ")
            self.answer(c, method: String(parts[0]), path: String(parts[1]), headers: headers, body: Data(body))
        }
    }

    private func answer(_ c: NWConnection, method: String, path: String, headers: [String: String], body: Data) {
        var status = "200 OK"
        var extra: [String] = []
        var text = ""
        switch (method, path) {
        case ("POST", "/api/login"):
            status = "204 No Content"
            extra = ["Set-Cookie: __Host-id=abc; Max-Age=34560000; Path=/; Secure; HttpOnly; SameSite=Lax"]
        case ("POST", "/api/logout"):
            status = "204 No Content"
            extra = ["Set-Cookie: __Host-id=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax"]
        case ("GET", "/api/redirect"):
            status = "302 Found"
            extra = ["Location: http://127.0.0.1:\(port)/api/me"]
        case ("POST", "/api/echo"):
            text = String(decoding: body, as: UTF8.self)
        case ("GET", "/api/me"), ("GET", "/api/me?x=1"):
            let fields: [String: String] = [
                "cookie": headers["cookie"] ?? "", "origin": headers["origin"] ?? "",
                "secFetchSite": headers["sec-fetch-site"] ?? "", "path": path,
            ]
            text = String(decoding: try! JSONSerialization.data(withJSONObject: fields, options: .sortedKeys), as: UTF8.self)
            extra = ["Content-Type: application/json"]
        default:
            status = "404 Not Found"
        }
        let bytes = Data(text.utf8)
        let response = (["HTTP/1.1 \(status)", "Content-Length: \(bytes.count)", "Connection: close"] + extra)
            .joined(separator: "\r\n") + "\r\n\r\n"
        c.send(content: Data(response.utf8) + bytes, completion: .contentProcessed { _ in c.cancel() })
    }
}

@MainActor
@Suite(.serialized)
struct ForwardPipeTests {
    /// 存在記憶體的罐子；同一個 saved 再建一個就是「關掉再開」。
    final class Saved { var data: Data? }
    func jar(_ site: URL, _ saved: Saved) -> CookieJar {
        CookieJar(site: site, load: { saved.data }, save: { saved.data = $0 })
    }

    func me(_ h: Harness) async throws -> [String: String] {
        let text = try await h.js("return await (await fetch('/api/me')).text()") as? String ?? ""
        return (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: String]) ?? [:]
    }

    @Test func 網頁打api_殼轉到網站_標上網站的網址_登入cookie殼自己帶() async throws {
        let site = try await TinySite()
        let saved = Saved()
        let h = Harness(siteRoot: fixtures, routes: { _ in [ForwardRoute(site: site.url, jar: self.jar(site.url, saved))] })
        try await h.load("pipe.html")

        let status = try await h.js("return (await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status") as? Int
        #expect(status == 204)
        let got = try await me(h)
        #expect(got["cookie"] == "__Host-id=abc")
        #expect(got["origin"] == "http://127.0.0.1:\(site.port)")
        #expect(got["secFetchSite"] == "")

        // 網頁拿不到：document.cookie 是空的，網頁畫面的 cookie 也沒有
        #expect(try await h.js("return document.cookie") as? String == "")
        let webCookies = await h.shell.webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        #expect(webCookies.isEmpty)

        // 關掉再開（新的網頁畫面、新的罐子，讀存起來的）還登著
        let reopened = Harness(siteRoot: fixtures, routes: { _ in [ForwardRoute(site: site.url, jar: self.jar(site.url, saved))] })
        try await reopened.load("pipe.html")
        #expect(try await me(reopened)["cookie"] == "__Host-id=abc")

        // 登出後清掉
        _ = try await reopened.js("return (await fetch('/api/logout', {method: 'POST', body: '{}'})).status")
        #expect(try await me(reopened)["cookie"] == "")
    }

    @Test func 內容和查詢字串照樣到_轉址不跟() async throws {
        let site = try await TinySite()
        let h = Harness(siteRoot: fixtures, routes: { _ in [ForwardRoute(site: site.url, jar: self.jar(site.url, Saved()))] })
        try await h.load("pipe.html")
        #expect(try await h.js("return await (await fetch('/api/echo', {method: 'POST', body: JSON.stringify({名字: '林'})})).text()") as? String == #"{"名字":"林"}"#)
        #expect(try await h.js("return JSON.parse(await (await fetch('/api/me?x=1')).text()).path") as? String == "/api/me?x=1")
        // 轉址的回應交給網頁（WebKit 自己處理成什麼樣不管），殼不跟過去
        let redirected = try await h.js("try { const r = await fetch('/api/redirect'); return r.url } catch (e) { return 'failed' }") as? String
        #expect(redirected != "http://127.0.0.1:\(site.port)/api/me")
    }

    @Test func 不是api的不轉() async throws {
        let site = try await TinySite()
        let h = Harness(siteRoot: fixtures, routes: { _ in [ForwardRoute(site: site.url, jar: self.jar(site.url, Saved()))] })
        try await h.load("pipe.html")
        #expect(try await h.js("return (await fetch('/apix')).status") as? Int == 404)
        #expect(try await h.js("return (await fetch('/pipe.html')).status") as? Int == 200)
    }

    @Test func 連不上網站_網頁的fetch失敗_不是當成沒登入() async throws {
        let closed = URL(string: "http://127.0.0.1:9/")!  // discard 埠，沒人聽
        let h = Harness(siteRoot: fixtures, routes: { _ in [ForwardRoute(site: closed, jar: self.jar(closed, Saved()))] })
        try await h.load("pipe.html")
        let got = try await h.js("try { const r = await fetch('/api/me'); return 'status ' + r.status } catch (e) { return 'failed' }") as? String
        #expect(got == "failed")
    }
}
