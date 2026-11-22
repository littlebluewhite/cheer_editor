// 雲端流程的音樂經過殼（#382）：網頁 fetch('/cloud-music?url=<預簽網址>')，殼照預簽網址直接送到 R2。
// 送出去的那一步換成假的（不連網）；真的連線在模擬器的管子測試（ios/PipeTests/CloudMusicPipeTests.swift）。
import Foundation
import Testing
import ShellCore

let presigned = "https://abc123.r2.cloudflarestorage.com/music/uploading/flows/f%2F1/a1.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=k%2F20261123%2Fauto%2Fs3%2Faws4_request&X-Amz-Signature=ab%2Bcd"

func music(_ url: String, method: String = "GET", body: Data? = nil, headers: [String: String] = [:]) -> URLRequest {
    let q = url.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
    var r = URLRequest(url: URL(string: "app://local/cloud-music?url=\(q)")!)
    r.httpMethod = method
    r.httpBody = body
    for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
    return r
}

@MainActor
final class FakeR2 {
    var sent: [URLRequest] = []
    var down = false
    var answer = (status: 200, headers: ["Content-Type": "audio/mpeg", "Set-Cookie": "x=1"], body: Data("聲音".utf8))

    func relay(_ request: URLRequest, allowLocal: Bool = false) async throws -> (HTTPURLResponse, Data) {
        try await CloudMusic.relay(request, allowLocal: allowLocal, send: { r in
            self.sent.append(r)
            if self.down { throw URLError(.networkConnectionLost) }
            return (self.answer.body, HTTPURLResponse(url: r.url!, statusCode: self.answer.status, httpVersion: "HTTP/1.1", headerFields: self.answer.headers)!)
        })
    }
}

@MainActor
struct CloudMusicTests {
    @Test func 只接app的cloud_music() {
        #expect(CloudMusic.handles(music(presigned)))
        #expect(!CloudMusic.handles(web("/api/me")))
        #expect(!CloudMusic.handles(web("/cloud-musicx?url=a")))
        #expect(!CloudMusic.handles(URLRequest(url: URL(string: "app://other/cloud-music?url=a")!)))
    }

    @Test func 預簽網址一個字不差送到R2_不帶網頁的cookie和網址() async throws {
        let fake = FakeR2()
        let bytes = Data(repeating: 7, count: 1000)
        _ = try await fake.relay(music(presigned, method: "PUT", body: bytes,
                                       headers: ["Cookie": "web=1", "Origin": "app://local", "Content-Type": "application/octet-stream"]))
        let sent = try #require(fake.sent.first)
        #expect(sent.url?.absoluteString == presigned)
        #expect(sent.httpMethod == "PUT")
        #expect(sent.httpBody == bytes)
        #expect(sent.allHTTPHeaderFields?.isEmpty ?? true)
    }

    @Test func 回給網頁的是R2的狀態和內容_沒有Set_Cookie() async throws {
        let fake = FakeR2()
        let (response, data) = try await fake.relay(music(presigned))
        #expect(response.statusCode == 200)
        #expect(data == Data("聲音".utf8))
        #expect(response.value(forHTTPHeaderField: "Content-Type") == "audio/mpeg")
        #expect(response.value(forHTTPHeaderField: "Set-Cookie") == nil)
        #expect(response.url?.scheme == "app")
        fake.answer = (403, [:], Data())
        #expect(try await fake.relay(music(presigned)).0.statusCode == 403)
    }

    @Test func 只送到R2_只有GET和PUT() async {
        let fake = FakeR2()
        for bad in ["https://evil.example/x", "http://abc.r2.cloudflarestorage.com/x", "https://r2.cloudflarestorage.com.evil.example/x",
                    "http://127.0.0.1:8080/x", "file:///etc/passwd", "not a url"] {
            await #expect(throws: (any Error).self, "\(bad)") { try await fake.relay(music(bad)) }
        }
        await #expect(throws: (any Error).self) { try await fake.relay(music(presigned, method: "DELETE")) }
        await #expect(throws: (any Error).self) { try await fake.relay(URLRequest(url: URL(string: "app://local/cloud-music")!)) }
        #expect(fake.sent.isEmpty)
    }

    @Test func 開發版可以送到本機的假R2() async throws {
        let fake = FakeR2()
        _ = try await fake.relay(music("http://127.0.0.1:9000/music/a?X-Amz-Signature=1"), allowLocal: true)
        #expect(fake.sent.first?.url?.absoluteString == "http://127.0.0.1:9000/music/a?X-Amz-Signature=1")
    }

    @Test func 傳到一半斷線_網頁的fetch失敗() async {
        let fake = FakeR2()
        fake.down = true
        await #expect(throws: URLError.self) { try await fake.relay(music(presigned, method: "PUT", body: Data([1]))) }
    }

    @Test func 一開始告訴網頁殼會代傳音樂() {
        #expect(CloudMusicPart().feature == "cloudMusic")
    }
}
