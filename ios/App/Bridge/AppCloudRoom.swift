// 雲端流程的連線（#381）：App 裡的那一塊。規則在 ShellCore 的 CloudRoomPart；這裡只接系統：
// - 連線用 URLSessionWebSocketTask（不用系統的 cookie、快取；cookie 由 CloudRoomPart 從殼的罐子 AppSite.cookies 帶）。
// - App 切到背景、鎖螢幕（UIScene.didEnterBackgroundNotification）關掉連線；回到前景（willEnterForeground）跟網頁說。
//   不用 willDeactivate：拉下控制中心、滑到 App 切換器也會發，那時不該斷線、不能改。
import Foundation
import ShellCore
import UIKit

extension CloudRoomPart {
    static func inApp(outbox: ShellOutbox, site: URL = AppSite.current, jar: CookieJar = AppSite.cookies) -> CloudRoomPart {
        let part = CloudRoomPart(site: site, cookie: { jar.header() }, outbox: outbox, connect: AppRoomSocket.open)
        // 一直聽到 App 結束（App 只建一次）
        _ = NotificationCenter.default.addObserver(forName: UIScene.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { part.enterBackground() }
        }
        _ = NotificationCenter.default.addObserver(forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { part.enterForeground() }
        }
        return part
    }
}

/// 一條 URLSessionWebSocketTask：連上、收到、斷了交給 events（都回到主執行緒）；殼關的不再說。
@MainActor
final class AppRoomSocket: NSObject, RoomSocketConnection {
    private var events: RoomSocketEvents?
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?

    static func open(_ request: URLRequest, _ events: RoomSocketEvents) -> any RoomSocketConnection {
        let socket = AppRoomSocket()
        socket.events = events
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        let session = URLSession(configuration: config, delegate: Delegate(socket), delegateQueue: .main)
        let task = session.webSocketTask(with: request)
        socket.session = session
        socket.task = task
        task.resume()
        socket.receive()
        return socket
    }

    func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    func close() {
        events = nil
        task?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(.string(let text)): self.events?.message(text); self.receive()
                case .success(.data(let data)): self.events?.message(String(decoding: data, as: UTF8.self)); self.receive()
                case .success: self.receive()
                case .failure: self.ended()
                }
            }
        }
    }

    fileprivate func opened() { events?.opened() }

    /// 伺服器關的、網路斷了、連不上：說一次斷了。
    fileprivate func ended() {
        guard let events else { return }
        close()
        events.closed()
    }

    /// URLSession 的 delegate 留著 socket 會互相抓著不放：session 關掉（invalidate）才放手。
    private final class Delegate: NSObject, URLSessionWebSocketDelegate {
        weak let socket: AppRoomSocket?
        init(_ socket: AppRoomSocket) { self.socket = socket }

        func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
            MainActor.assumeIsolated { socket?.opened() }
        }

        func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
            MainActor.assumeIsolated { socket?.ended() }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            MainActor.assumeIsolated { socket?.ended() }
        }

        /// 不跟轉址（跟轉送 /api/ 一樣）：cookie 不會跟著跑到別的地方。
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest) async -> URLRequest? { nil }
    }
}
