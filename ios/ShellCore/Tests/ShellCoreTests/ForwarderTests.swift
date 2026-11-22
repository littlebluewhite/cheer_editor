// 殼代網頁上網（#380，ADR 0023）：只轉自己網站的 /api/，送的時候標上網站的網址，登入 cookie 留在殼裡。
// 送出去的那一步換成假的（不連網）；真的連線在模擬器的管子測試（ios/PipeTests/ForwardPipeTests.swift）。
import Foundation
import Testing
import ShellCore

@MainActor
final class FakeSite {
    var sent: [URLRequest] = []
    var answers: [(status: Int, headers: [String: String], body: String)] = []
    var down = false
    var saved: Data?

    func forwarder(site: String = "https://littlebluewhite.com/") -> Forwarder {
        Forwarder(site: URL(string: site)!, jar: jar(), send: { request in
            self.sent.append(request)
            if self.down { throw URLError(.cannotConnectToHost) }
            let a = self.answers.isEmpty ? (status: 200, headers: [:], body: "") : self.answers.removeFirst()
            return (Data(a.body.utf8), HTTPURLResponse(url: request.url!, statusCode: a.status, httpVersion: "HTTP/1.1", headerFields: a.headers)!)
        })
    }

    /// 存在 saved 裡的罐子：再建一個就是「App 關掉再開」。
    func jar(site: String = "https://littlebluewhite.com/") -> CookieJar {
        CookieJar(site: URL(string: site)!, load: { self.saved }, save: { self.saved = $0 })
    }
}

func web(_ path: String, method: String = "GET", body: String? = nil, headers: [String: String] = [:]) -> URLRequest {
    var r = URLRequest(url: URL(string: "app://local\(path)")!)
    r.httpMethod = method
    r.httpBody = body.map { Data($0.utf8) }
    for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
    return r
}

let login = "__Host-id=abc; Max-Age=34560000; Path=/; Secure; HttpOnly; SameSite=Lax"
let logout = "__Host-id=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax"

@MainActor
struct ForwarderTests {
    @Test func 只轉自己網址的api() {
        #expect(Forwarder.handles(web("/api/me")))
        #expect(Forwarder.handles(web("/api/flows/a%2Fb/records?since=3")))
        #expect(!Forwarder.handles(web("/")))
        #expect(!Forwarder.handles(web("/apix")))
        #expect(!Forwarder.handles(web("/api")))
        #expect(!Forwarder.handles(web("/_app/immutable/start.js")))
        #expect(!Forwarder.handles(web("/api/../guide")))
        #expect(!Forwarder.handles(URLRequest(url: URL(string: "https://evil.example/api/me")!)))
        #expect(!Forwarder.handles(URLRequest(url: URL(string: "app://other/api/me")!)))
    }

    @Test func 轉到網站同一個路徑_方法內容照舊_標上網站的網址() async throws {
        let fake = FakeSite()
        let f = fake.forwarder()
        _ = try await f.forward(web("/api/flows/a%2Fb?x=1%202", method: "POST", body: #"{"a":1}"#,
                                    headers: ["Content-Type": "application/json", "Origin": "app://local",
                                              "Sec-Fetch-Site": "cross-site", "Referer": "app://local/", "Cookie": "web=1"]))
        let sent = try #require(fake.sent.first)
        #expect(sent.url?.absoluteString == "https://littlebluewhite.com/api/flows/a%2Fb?x=1%202")
        #expect(sent.httpMethod == "POST")
        #expect(sent.httpBody == Data(#"{"a":1}"#.utf8))
        #expect(sent.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(sent.value(forHTTPHeaderField: "Origin") == "https://littlebluewhite.com")
        #expect(sent.value(forHTTPHeaderField: "Sec-Fetch-Site") == nil)
        #expect(sent.value(forHTTPHeaderField: "Referer") == nil)
        #expect(sent.value(forHTTPHeaderField: "Cookie") == nil)
    }

    @Test func 本機的伺服器_網址帶埠號() async throws {
        let fake = FakeSite()
        _ = try await fake.forwarder(site: "http://127.0.0.1:8080/").forward(web("/api/logout", method: "POST", body: "{}"))
        #expect(fake.sent.first?.url?.absoluteString == "http://127.0.0.1:8080/api/logout")
        #expect(fake.sent.first?.value(forHTTPHeaderField: "Origin") == "http://127.0.0.1:8080")
    }

    @Test func 登入的cookie留在殼裡_網頁拿不到_之後的請求殼自己帶() async throws {
        let fake = FakeSite()
        let f = fake.forwarder()
        fake.answers = [(204, ["Set-Cookie": login], ""), (200, ["Content-Type": "application/json"], #"{"name":"林"}"#)]
        let (loginResponse, _) = try await f.forward(web("/api/login", method: "POST", body: "{}"))
        #expect(loginResponse.statusCode == 204)
        #expect(loginResponse.value(forHTTPHeaderField: "Set-Cookie") == nil)

        let (me, body) = try await f.forward(web("/api/me"))
        #expect(fake.sent[1].value(forHTTPHeaderField: "Cookie") == "__Host-id=abc")
        #expect(me.statusCode == 200)
        #expect(me.url?.absoluteString == "app://local/api/me")
        #expect(me.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(String(decoding: body, as: UTF8.self) == #"{"name":"林"}"#)
    }

    @Test func 本機的伺服器是http_Secure的cookie照樣留著() async throws {
        let fake = FakeSite()
        let f = fake.forwarder(site: "http://127.0.0.1:8080/")
        fake.answers = [(204, ["Set-Cookie": login], "")]
        _ = try await f.forward(web("/api/login", method: "POST", body: "{}"))
        _ = try await f.forward(web("/api/me"))
        #expect(fake.sent[1].value(forHTTPHeaderField: "Cookie") == "__Host-id=abc")
    }

    @Test func App關掉再開還登著() async throws {
        let fake = FakeSite()
        fake.answers = [(204, ["Set-Cookie": login], "")]
        _ = try await fake.forwarder().forward(web("/api/login", method: "POST", body: "{}"))
        let reopened = fake.forwarder()  // 新的罐子，從存起來的讀
        _ = try await reopened.forward(web("/api/me"))
        #expect(fake.sent[1].value(forHTTPHeaderField: "Cookie") == "__Host-id=abc")
    }

    @Test func 登出後登入資料清掉() async throws {
        let fake = FakeSite()
        let f = fake.forwarder()
        fake.answers = [(204, ["Set-Cookie": login], ""), (204, ["Set-Cookie": logout], "")]
        _ = try await f.forward(web("/api/login", method: "POST", body: "{}"))
        _ = try await f.forward(web("/api/logout", method: "POST", body: "{}"))
        _ = try await f.forward(web("/api/me"))
        #expect(fake.sent[2].value(forHTTPHeaderField: "Cookie") == nil)
        _ = try await fake.forwarder().forward(web("/api/me"))  // 關掉再開也沒有
        #expect(fake.sent[3].value(forHTTPHeaderField: "Cookie") == nil)
    }

    @Test func 回應的錯誤碼和內容照樣交給網頁() async throws {
        let fake = FakeSite()
        fake.answers = [(429, ["Content-Type": "application/json"], #"{"retryAfterSeconds":60}"#)]
        let (r, body) = try await fake.forwarder().forward(web("/api/login", method: "POST", body: "{}"))
        #expect(r.statusCode == 429)
        #expect(String(decoding: body, as: UTF8.self) == #"{"retryAfterSeconds":60}"#)
    }

    @Test func 已經解壓的內容不再說有壓縮_長度照實際的() async throws {
        let fake = FakeSite()
        fake.answers = [(200, ["Content-Encoding": "gzip", "Content-Length": "5"], "0123456789")]
        let (r, _) = try await fake.forwarder().forward(web("/api/me"))
        #expect(r.value(forHTTPHeaderField: "Content-Encoding") == nil)
        #expect(r.value(forHTTPHeaderField: "Content-Length") == "10")
    }

    @Test func 連不上網站_丟錯誤讓網頁的fetch失敗() async throws {
        let fake = FakeSite()
        fake.down = true
        await #expect(throws: (any Error).self) { try await fake.forwarder().forward(web("/api/me")) }
    }

    @Test func 別的網站的cookie不收() async throws {
        let jar = FakeSite().jar()
        jar.take(setCookie: ["Set-Cookie": "x=1; Domain=evil.example; Path=/"])
        #expect(jar.header() == nil)
    }
}

@MainActor
struct SiteAddressTests {
    @Test func 上架版只連自己的網站() {
        #expect(SiteAddress.pick(debug: false, override: "http://127.0.0.1:8080/") == SiteAddress.production)
    }

    @Test func 開發時可以連本機的伺服器() {
        #expect(SiteAddress.pick(debug: true, override: "http://127.0.0.1:8080/").absoluteString == "http://127.0.0.1:8080/")
        #expect(SiteAddress.pick(debug: true, override: nil) == SiteAddress.production)
        #expect(SiteAddress.pick(debug: true, override: "not a url") == SiteAddress.production)
    }

    @Test func 一開始告訴網頁網站的網址() {
        #expect(SitePart(site: SiteAddress.production).boot == ["siteUrl": "https://littlebluewhite.com/"])
    }
}
