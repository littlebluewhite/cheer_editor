// 雲端流程的連線（#381，#304 的結論，情境 bridge-scenarios/current/cloudRoom.json）。
// App 裡的網頁不自己開 WebSocket（app://local 帶不到登入 cookie、過不了伺服器的同網址檢查）：網頁請殼開，
// 殼帶自己 CookieJar 的 cookie、標上網站自己的網址（Origin），跟轉送 /api/ 一樣（Forwarder）。網頁那邊是 src/lib/shell-socket.ts。
// - 只開自己網站（site）底下 /api/ 的連線：殼的 cookie 不會跑到別的地方。
// - App 切到背景、鎖螢幕：殼關掉每一條，說 socketClosed（background: true）；在背景時要開也馬上關。回到前景說 foreground，網頁自己重連。
// 真的連線（URLSessionWebSocketTask）由 App 傳進來（connect），這裡只管規則。
import Foundation

/// 一條開著的連線（App 裡是 URLSessionWebSocketTask）。
@MainActor
public protocol RoomSocketConnection: AnyObject {
    func send(_ text: String)
    /// 殼關的：之後不再叫 events。
    func close()
}

/// 連線發生的事：連上了、收到一句、斷了（伺服器關的、網路斷了）。
public struct RoomSocketEvents {
    public let opened: @MainActor () -> Void
    public let message: @MainActor (String) -> Void
    public let closed: @MainActor () -> Void

    public init(opened: @escaping @MainActor () -> Void, message: @escaping @MainActor (String) -> Void, closed: @escaping @MainActor () -> Void) {
        self.opened = opened
        self.message = message
        self.closed = closed
    }
}

/// 照請求（網址、Cookie、Origin 都放好了）開一條連線。
public typealias RoomSocketConnect = @MainActor (URLRequest, RoomSocketEvents) -> any RoomSocketConnection

struct BadSocketMessage: Error {}

@MainActor
public final class CloudRoomPart: BridgePart {
    private let site: URL
    private let cookie: @MainActor () -> String?
    private let outbox: ShellOutbox
    private let connect: RoomSocketConnect
    /// 開著的（還在連的也算），照網頁給的 id。
    private var open: [Int: any RoomSocketConnection] = [:]
    private var asleep = false

    /// cookie：現在要帶的 Cookie（App 裡是 AppSite.cookies.header()）。
    public init(site: URL, cookie: @escaping @MainActor () -> String?, outbox: ShellOutbox, connect: @escaping RoomSocketConnect) {
        self.site = site
        self.cookie = cookie
        self.outbox = outbox
        self.connect = connect
    }

    public var feature: String? { "cloudRoom" }
    public var messages: Set<String> { ["socketOpen", "socketSend", "socketClose"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        guard case .object(let o) = body, case .number(let n)? = o["id"], let id = Int(exactly: n) else { throw BadSocketMessage() }
        switch name {
        case "socketOpen":
            guard case .string(let text)? = o["url"], let url = allowed(text) else { throw BadSocketMessage() }
            if asleep {
                outbox.emit("socketClosed", ["id": .number(Double(id)), "background": true])
                return nil
            }
            open[id]?.close()
            var request = URLRequest(url: url)
            request.setValue(Forwarder.origin(of: site), forHTTPHeaderField: "Origin")
            if let cookie = cookie() { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            let events = RoomSocketEvents(
                opened: { [weak self] in self?.emit("socketOpened", id) },
                message: { [weak self] text in self?.emit("socketMessage", id, ["text": .string(text)]) },
                closed: { [weak self] in
                    guard let self, self.open[id] != nil else { return }
                    self.open[id] = nil
                    self.outbox.emit("socketClosed", ["id": .number(Double(id))])
                })
            open[id] = connect(request, events)
        case "socketSend":
            guard case .string(let text)? = o["text"] else { throw BadSocketMessage() }
            open[id]?.send(text)
        default:
            open.removeValue(forKey: id)?.close()
        }
        return nil
    }

    /// App 切到背景、鎖螢幕：每一條都關掉，跟網頁說是背景關的（網頁不自己重連）。
    public func enterBackground() {
        asleep = true
        for id in open.keys.sorted() {
            open.removeValue(forKey: id)?.close()
            outbox.emit("socketClosed", ["id": .number(Double(id)), "background": true])
        }
    }

    /// 回到前景：跟網頁說，網頁馬上重連、補齊。
    public func enterForeground() {
        asleep = false
        outbox.emit("foreground", nil)
    }

    /// 還開著的才說（殼關掉以後連線晚到的話不轉）。
    private func emit(_ name: String, _ id: Int, _ more: [String: JSONValue] = [:]) {
        guard open[id] != nil else { return }
        outbox.emit(name, .object(["id": .number(Double(id))].merging(more) { a, _ in a }))
    }

    /// 網頁給的網址是不是自己網站底下 /api/ 的連線（https 用 wss、http 用 ws，主機、埠一樣，不帶帳號、沒有 . ..）。
    private func allowed(_ text: String) -> URL? {
        guard let c = URLComponents(string: text), let url = c.url,
              c.scheme == (site.scheme == "https" ? "wss" : "ws"),
              c.host == site.host, c.port == site.port, c.user == nil, c.password == nil,
              c.percentEncodedPath.hasPrefix("/api/"),
              !c.percentEncodedPath.split(separator: "/").contains(where: { $0 == ".." || $0 == "." })
        else { return nil }
        return url
    }
}
