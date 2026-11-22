// 雲端流程的連線（#381）的管子：真的 WKWebView 跟殼說 socketOpen，真的 CloudRoomPart.inApp（URLSessionWebSocketTask）
// 連到測試自己在模擬器裡開的 WebSocket 伺服器（127.0.0.1，不連正式網站）。規則本身在 ShellCore 的 CloudRoomPartTests。
import Foundation
import Network
import ShellCore
import Testing
import UIKit
@testable import CheerEditor

/// 模擬器裡的小 WebSocket 伺服器：記下每條連線握手時帶的標頭；收到什麼回「回聲：什麼」；記下哪幾條被關了。
final class TinyRoom: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "tiny-room")
    private var started = false
    private final class Handshakes { var list: [[String: String]] = [] }
    private let seen: Handshakes
    private var _ended = 0
    private var connections: [NWConnection] = []
    private(set) var port: UInt16 = 0
    var site: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    var handshakes: [[String: String]] { queue.sync { seen.list } }
    var ended: Int { queue.sync { _ended } }

    init() async throws {
        // 握手的標頭：要在選項放進 parameters 之前接上（之後接的不會叫）
        let seen = Handshakes()
        self.seen = seen
        let ws = NWProtocolWebSocket.Options()
        ws.setClientRequestHandler(queue) { _, headers in
            var got: [String: String] = [:]
            for (name, value) in headers { got[name.lowercased()] = value }
            seen.list.append(got)
            return NWProtocolWebSocket.Response(status: .accept, subprotocol: nil)
        }
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        listener = try NWListener(using: parameters, on: .any)
        listener.newConnectionHandler = { [weak self] c in
            guard let self else { return }
            c.stateUpdateHandler = { [weak self] state in
                switch state {
                case .cancelled, .failed: self?._ended += 1
                default: break
                }
            }
            self.connections.append(c)
            c.start(queue: self.queue)
            self.echo(c)
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

    /// 伺服器那邊關掉每一條。
    func closeAll() { queue.sync { for c in connections { c.cancel() } } }

    private func echo(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, context, _, error in
            guard let self else { return }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if error != nil || meta?.opcode == .close { c.cancel(); return }
            if let data, meta?.opcode == .text {
                let reply = NWProtocolWebSocket.Metadata(opcode: .text)
                let out = NWConnection.ContentContext(identifier: "echo", metadata: [reply])
                c.send(content: Data("回聲：".utf8) + data, contentContext: out, isComplete: true, completion: .idempotent)
            }
            self.echo(c)
        }
    }
}

@MainActor
@Suite(.serialized)
struct CloudRoomPipeTests {
    /// 已經登入的罐子（殼轉送 /api/login 時收的那個 cookie）。
    func signedIn(_ site: URL) -> CookieJar {
        CookieJar(site: site, load: { Data(#"{"__Host-id":{"value":"abc"}}"#.utf8) }, save: { _ in })
    }

    func heard(_ h: Harness) async -> String {
        (try? await h.js("return window.heard.join(' | ')")) as? String ?? ""
    }

    @Test func 網頁請殼開連線_帶殼的cookie和網站的網址_送得出收得到_切到背景關掉_回到前景說一聲() async throws {
        let room = try await TinyRoom()
        let site = room.site
        let h = Harness(siteRoot: fixtures, parts: { [CloudRoomPart.inApp(outbox: $0.outbox, site: site, jar: self.signedIn(site))] })
        try await h.load("pipe.html")
        let url = "ws://127.0.0.1:\(room.port)/api/flows/c1/room"
        _ = try await h.js("""
            window.heard = [];
            for (const name of ['socketOpened', 'socketMessage', 'socketClosed', 'foreground'])
                window.__cheerShell.on(name, (b) => window.heard.push(name + ' ' + JSON.stringify(b, Object.keys(b ?? {}).sort())));
            await window.__cheerShell.send('socketOpen', { id: 1, url });
            return null
            """, ["url": url])
        try await h.waitUntil("連上了") { await heard(h) == #"socketOpened {"id":1}"# }
        #expect(room.handshakes.count == 1)
        #expect(room.handshakes.first?["cookie"] == "__Host-id=abc")
        #expect(room.handshakes.first?["origin"] == "http://127.0.0.1:\(room.port)")
        // 伺服器的同網址檢查（server/src/csrf.rs）：沒有 Sec-Fetch-Site 就比 Origin 的主機和埠跟 Host 一樣
        #expect(room.handshakes.first?["sec-fetch-site"] == nil)
        #expect(room.handshakes.first?["host"] == "127.0.0.1:\(room.port)")

        _ = try await h.js("await window.__cheerShell.send('socketSend', { id: 1, text: '加油' }); return null")
        try await h.waitUntil("收到回聲") { await heard(h).contains("socketMessage") }
        #expect(await heard(h) == #"socketOpened {"id":1} | socketMessage {"id":1,"text":"回聲：加油"}"#)

        // 切到背景：殼關掉連線（伺服器那邊也斷了），跟網頁說是背景關的；在背景時要開也馬上關
        _ = try await h.js("window.heard = []; return null")
        NotificationCenter.default.post(name: UIScene.didEnterBackgroundNotification, object: nil)
        try await h.waitUntil("伺服器那邊斷了") { room.ended == 1 }
        _ = try await h.js("await window.__cheerShell.send('socketOpen', { id: 2, url }); return null", ["url": url])
        #expect(await heard(h) == #"socketClosed {"background":true,"id":1} | socketClosed {"background":true,"id":2}"#)
        #expect(room.handshakes.count == 1)

        // 回到前景：跟網頁說，再開就連得上
        _ = try await h.js("window.heard = []; return null")
        NotificationCenter.default.post(name: UIScene.willEnterForegroundNotification, object: nil)
        try await h.waitUntil("網頁聽到回到前景") { await heard(h) == "foreground null" }
        _ = try await h.js("await window.__cheerShell.send('socketOpen', { id: 3, url }); return null", ["url": url])
        try await h.waitUntil("又連上了") { await heard(h).contains(#"socketOpened {"id":3}"#) }
        #expect(room.handshakes.count == 2)
    }

    @Test func 伺服器關掉_跟網頁說斷了_不是背景關的() async throws {
        let room = try await TinyRoom()
        let site = room.site
        let h = Harness(siteRoot: fixtures, parts: { [CloudRoomPart.inApp(outbox: $0.outbox, site: site, jar: self.signedIn(site))] })
        try await h.load("pipe.html")
        _ = try await h.js("""
            window.heard = [];
            for (const name of ['socketOpened', 'socketClosed'])
                window.__cheerShell.on(name, (b) => window.heard.push(name + ' ' + JSON.stringify(b, Object.keys(b ?? {}).sort())));
            await window.__cheerShell.send('socketOpen', { id: 1, url: 'ws://127.0.0.1:\(room.port)/api/flows/c1/room' });
            return null
            """)
        try await h.waitUntil("連上了") { await heard(h) == #"socketOpened {"id":1}"# }
        // 伺服器關掉這條（部署換手、斷網）
        room.closeAll()
        try await h.waitUntil("網頁聽到斷了") { await heard(h).contains("socketClosed") }
        #expect(await heard(h) == #"socketOpened {"id":1} | socketClosed {"id":1}"#)
    }
}
