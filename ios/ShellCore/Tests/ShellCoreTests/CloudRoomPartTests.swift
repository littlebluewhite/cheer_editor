// 雲端流程的連線（#381）：網頁請殼開，殼帶自己的登入 cookie、標上網站的網址；只開自己網站的 /api/…。
// 切到背景殼關掉每一條，在背景時要開也馬上關；回到前景跟網頁說。
import Foundation
import Testing
import ShellCore

/// 假的連線：記下開了哪幾條（請求）、送了什麼、關了沒有；測試叫 open()、say()、drop() 學伺服器。
@MainActor
final class FakeRoomSockets {
    final class Connection: RoomSocketConnection {
        let request: URLRequest
        let events: RoomSocketEvents
        var sent: [String] = []
        var closed = false
        init(request: URLRequest, events: RoomSocketEvents) {
            self.request = request
            self.events = events
        }
        func send(_ text: String) { sent.append(text) }
        func close() { closed = true }
        func open() { events.opened() }
        func say(_ text: String) { events.message(text) }
        func drop() { events.closed() }
    }

    private(set) var connections: [Connection] = []
    var last: Connection? { connections.last }

    lazy var connect: RoomSocketConnect = { [unowned self] request, events in
        let c = Connection(request: request, events: events)
        self.connections.append(c)
        return c
    }
}

@MainActor
struct CloudRoomPartTests {
    @MainActor final class Setup {
        let sockets = FakeRoomSockets()
        var said: [JSONValue] = []
        var cookie: String? = "__Host-id=abc"
        let part: CloudRoomPart
        let bridge: Bridge

        init(site: URL = URL(string: "https://littlebluewhite.com/")!) {
            let outbox = ShellOutbox()
            var cookie: () -> String? = { nil }
            part = CloudRoomPart(site: site, cookie: { cookie() }, outbox: outbox, connect: sockets.connect)
            bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [part])
            cookie = { [unowned self] in self.cookie }
            outbox.deliver = { [unowned self] name, body in self.said.append(["name": .string(name), "body": body]) }
        }

        func open(_ id: Double, _ url: String = "wss://littlebluewhite.com/api/flows/c1/room") async -> BridgeAnswer {
            await bridge.handle(name: "socketOpen", body: ["id": .number(id), "url": .string(url)])
        }
    }

    static func said(_ name: String, _ body: JSONValue) -> JSONValue { ["name": .string(name), "body": body] }

    @Test func 會的事叫cloudRoom() {
        #expect(Setup().bridge.features == ["cloudRoom"])
    }

    @Test func 開連線_帶殼的登入cookie_標上網站的網址() async throws {
        let s = Setup()
        #expect(await s.open(1) == .reply(nil))
        let request = try #require(s.sockets.last?.request)
        #expect(request.url?.absoluteString == "wss://littlebluewhite.com/api/flows/c1/room")
        #expect(request.value(forHTTPHeaderField: "Cookie") == "__Host-id=abc")
        #expect(request.value(forHTTPHeaderField: "Origin") == "https://littlebluewhite.com")
    }

    @Test func 本機的伺服器_http用ws_埠也要一樣() async throws {
        let s = Setup(site: URL(string: "http://127.0.0.1:8080/")!)
        s.cookie = nil
        #expect(await s.open(1, "ws://127.0.0.1:8080/api/flows/c1/room") == .reply(nil))
        let request = try #require(s.sockets.last?.request)
        #expect(request.value(forHTTPHeaderField: "Origin") == "http://127.0.0.1:8080")
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    }

    @Test(arguments: [
        "wss://evil.example/api/flows/c1/room",
        "ws://littlebluewhite.com/api/flows/c1/room",
        "wss://littlebluewhite.com:444/api/flows/c1/room",
        "wss://littlebluewhite.com/flows/c1/room",
        "wss://littlebluewhite.com/api/../admin",
        "https://littlebluewhite.com/api/flows/c1/room",
        "wss://user@littlebluewhite.com/api/flows/c1/room",
    ])
    func 不是自己網站的api_不開_cookie不出去(_ url: String) async {
        let s = Setup()
        #expect(await s.open(1, url) == .error("failed"))
        #expect(s.sockets.connections.isEmpty)
    }

    @Test func 連上_收到_斷了都跟網頁說_送的交給連線() async throws {
        let s = Setup()
        _ = await s.open(1)
        let c = try #require(s.sockets.last)
        c.open()
        #expect(await s.bridge.handle(name: "socketSend", body: ["id": 1, "text": "hi"]) == .reply(nil))
        c.say("{\"kind\":\"ready\"}")
        c.drop()
        c.say("太晚了")
        #expect(c.sent == ["hi"])
        #expect(s.said == [
            Self.said("socketOpened", ["id": 1]),
            Self.said("socketMessage", ["id": 1, "text": "{\"kind\":\"ready\"}"]),
            Self.said("socketClosed", ["id": 1]),
        ])
    }

    @Test func 網頁關的_殼關掉_不再說話() async throws {
        let s = Setup()
        _ = await s.open(1)
        let c = try #require(s.sockets.last)
        c.open()
        #expect(await s.bridge.handle(name: "socketClose", body: ["id": 1]) == .reply(nil))
        c.drop()
        #expect(c.closed)
        #expect(await s.bridge.handle(name: "socketSend", body: ["id": 1, "text": "hi"]) == .reply(nil))
        #expect(c.sent == [])
        #expect(s.said == [Self.said("socketOpened", ["id": 1])])
    }

    @Test func 切到背景_每一條都關掉_跟網頁說是背景關的() async throws {
        let s = Setup()
        _ = await s.open(1)
        _ = await s.open(2)
        s.sockets.connections[0].open()
        s.said.removeAll()
        s.part.enterBackground()
        s.sockets.connections[0].drop()
        #expect(s.sockets.connections.allSatisfy { $0.closed })
        #expect(s.said == [
            Self.said("socketClosed", ["id": 1, "background": true]),
            Self.said("socketClosed", ["id": 2, "background": true]),
        ])
    }

    @Test func 在背景時要開_不開_馬上說關了() async {
        let s = Setup()
        s.part.enterBackground()
        #expect(await s.open(3) == .reply(nil))
        #expect(s.sockets.connections.isEmpty)
        #expect(s.said == [Self.said("socketClosed", ["id": 3, "background": true])])
    }

    @Test func 回到前景_跟網頁說_又開得了() async {
        let s = Setup()
        s.part.enterBackground()
        s.part.enterForeground()
        #expect(s.said == [Self.said("foreground", nil)])
        _ = await s.open(1)
        #expect(s.sockets.connections.count == 1)
    }
}
