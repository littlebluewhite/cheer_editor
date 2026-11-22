// 雲端流程的音樂經過殼（#382）的管子：真的 WKWebView 用 fetch('/cloud-music?url=…')，真的 CloudMusicRoute（URLSession）
// 送到測試自己在模擬器裡開的假 R2（127.0.0.1，Debug 版才准）。規則本身在 ShellCore 的 CloudMusicTests。
// 60 MB 上傳、下載要多久印在測試的輸出（模擬器、本機，不是真的 R2、不是真的網路）。
import Foundation
import Network
import ShellCore
import Testing
import WebKit
@testable import CheerEditor

/// 模擬器裡的假 R2：PUT 存起來、GET 拿回去（照路徑，不驗簽名）。
/// 路徑是 /drop 開頭的，PUT 收到一點就斷線；GET 說要給 60 MB，給一點就斷線。
final class FakeR2Site: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "fake-r2")
    private var started = false
    private(set) var port: UInt16 = 0
    private var stored: [String: Data] = [:]
    private var seenList: [(target: String, headers: [String])] = []
    /// 收到的每個請求：原封不動的路徑和查詢字串、標頭（小寫）。
    var seen: [(target: String, headers: [String])] { queue.sync { seenList } }

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

    func url(_ path: String) -> String { "http://127.0.0.1:\(port)\(path)?X-Amz-Signature=ab%2Bcd" }

    private func read(_ c: NWConnection, _ buffer: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [self] data, _, end, _ in
            let got = buffer + (data ?? Data())
            guard let split = got.range(of: Data("\r\n\r\n".utf8)) else {
                if !end { self.read(c, got) } else { c.cancel() }
                return
            }
            let lines = String(decoding: got[..<split.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
            let length = lines.first { $0.lowercased().hasPrefix("content-length:") }
                .flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
            let parts = lines[0].split(separator: " ")
            let method = String(parts[0])
            let path = String(parts[1].split(separator: "?")[0])
            let body = got.count - split.upperBound
            if method == "PUT" && path.hasPrefix("/drop") && body > 0 { c.cancel(); return }
            if body < length, !end { self.read(c, got); return }
            self.seenList.append((target: String(parts[1]), headers: lines.dropFirst().map { $0.lowercased() }))
            self.answer(c, method: method, path: path, body: Data(got[split.upperBound...]))
        }
    }

    private func answer(_ c: NWConnection, method: String, path: String, body: Data) {
        var bytes = Data()
        var status = "200 OK"
        if method == "PUT" {
            stored[path] = body
        } else if path.hasPrefix("/drop") {
            let head = "HTTP/1.1 200 OK\r\nContent-Length: \(60 * 1024 * 1024)\r\n\r\n"
            c.send(content: Data(head.utf8) + Data(count: 1000), completion: .contentProcessed { _ in c.cancel() })
            return
        } else if let saved = stored[path] {
            bytes = saved
        } else {
            status = "404 Not Found"
        }
        let head = "HTTP/1.1 \(status)\r\nContent-Length: \(bytes.count)\r\nContent-Type: audio/mpeg\r\nConnection: close\r\n\r\n"
        c.send(content: Data(head.utf8) + bytes, completion: .contentProcessed { _ in c.cancel() })
    }
}

@MainActor
@Suite(.serialized)
struct CloudMusicPipeTests {
    /// 網頁做 size 個 byte（0、1、2…255 一直重複），PUT 上去再 GET 回來；回 [傳上去的狀態, 拿回來的大小, 內容一樣嗎, 上傳毫秒, 下載毫秒]。
    func roundTrip(_ h: Harness, _ url: String, size: Int) async throws -> [Any] {
        try await h.js("""
            const bytes = new Uint8Array(size);
            for (let i = 0; i < size; i++) bytes[i] = i & 255;
            const file = new File([bytes], 'song.mp3');
            const via = '/cloud-music?url=' + encodeURIComponent(url);
            let t = performance.now();
            const put = await fetch(via, { method: 'PUT', body: await file.arrayBuffer() });
            const up = performance.now() - t;
            t = performance.now();
            const back = new Uint8Array(await (await fetch(via)).arrayBuffer());
            const down = performance.now() - t;
            let same = back.length === size;
            for (let i = 0; same && i < size; i += 4099) same = back[i] === (i & 255);
            return [put.status, back.length, same, Math.round(up), Math.round(down)];
            """, ["url": url, "size": size]) as? [Any] ?? []
    }

    @Test func 六十MB的音樂傳上去再拿回來() async throws {
        let r2 = try await FakeR2Site()
        let h = Harness(siteRoot: fixtures, routes: { _ in [CloudMusicRoute()] })
        try await h.load("pipe.html")
        let size = 60 * 1024 * 1024
        let got = try await roundTrip(h, r2.url("/music/flows/f%2F1/a1.mp3"), size: size)
        #expect(got.count == 5)
        #expect(got.first as? Int == 200)
        #expect(got.dropFirst().first as? Int == size)
        #expect(got.dropFirst(2).first as? Bool == true)
        // 預簽網址一個字不差到 R2（簽名靠它）；不帶 cookie、網頁的網址
        let seen = r2.seen
        #expect(seen.map(\.target) == Array(repeating: "/music/flows/f%2F1/a1.mp3?X-Amz-Signature=ab%2Bcd", count: 2))
        #expect(!seen.flatMap(\.headers).contains { $0.hasPrefix("cookie:") || $0.hasPrefix("origin:") || $0.hasPrefix("referer:") })
        print("#382 60 MB 經過殼（模擬器、本機假 R2）：上傳 \(got.dropFirst(3).first ?? "?") ms，下載 \(got.dropFirst(4).first ?? "?") ms")
    }

    @Test func 傳到一半斷線_網頁的fetch失敗_再試一次就好() async throws {
        let r2 = try await FakeR2Site()
        let h = Harness(siteRoot: fixtures, routes: { _ in [CloudMusicRoute()] })
        try await h.load("pipe.html")
        let attempt = """
            const via = '/cloud-music?url=' + encodeURIComponent(url);
            try {
                const r = put ? await fetch(via, { method: 'PUT', body: new Uint8Array(8 * 1024 * 1024).buffer }) : await fetch(via);
                await r.arrayBuffer();
                return 'ok ' + r.status;
            } catch (e) { return 'failed' }
            """
        #expect(try await h.js(attempt, ["url": r2.url("/drop/a1.mp3"), "put": true]) as? String == "failed")
        #expect(try await h.js(attempt, ["url": r2.url("/drop/a1.mp3"), "put": false]) as? String == "failed")
        // 再試一次（網路回來了）照常
        #expect(try await h.js(attempt, ["url": r2.url("/music/a1.mp3"), "put": true]) as? String == "ok 200")
    }

    @Test func 不是R2的網址不送() async throws {
        let h = Harness(siteRoot: fixtures, routes: { _ in [CloudMusicRoute()] })
        try await h.load("pipe.html")
        let got = try await h.js("""
            try { await fetch('/cloud-music?url=' + encodeURIComponent('https://evil.example/x')); return 'sent' } catch (e) { return 'failed' }
            """) as? String
        #expect(got == "failed")
    }
}
