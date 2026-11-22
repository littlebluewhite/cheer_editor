// app://local/ 的每個請求：先問 SchemeRoutes 有沒有哪一條接（例：#380 轉送 /api/），沒有就送 App 裡那包網頁的檔。
// 對檔的規則在 ShellCore 的 BundledSite。
import ShellCore
import WebKit

/// 自訂網址上的一條路（一條一個檔，登記在 SchemeRoutes.swift）。
@MainActor
protocol SchemeRoute {
    func handles(_ request: URLRequest) -> Bool
    func respond(to request: URLRequest) async -> (HTTPURLResponse, Data)
}

@MainActor
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let siteRoot: URL
    private let routes: [any SchemeRoute]
    /// 網頁已經不要的請求（換頁、取消）：不能再回，WebKit 會當掉。
    private var stopped: Set<ObjectIdentifier> = []

    init(siteRoot: URL, routes: [any SchemeRoute]) {
        self.siteRoot = siteRoot
        self.routes = routes
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        let request = task.request
        let id = ObjectIdentifier(task)
        Task { @MainActor in
            let (response, data) = await self.respond(to: request)
            guard !self.stopped.contains(id) else { self.stopped.remove(id); return }
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func respond(to request: URLRequest) async -> (HTTPURLResponse, Data) {
        if let route = routes.first(where: { $0.handles(request) }) { return await route.respond(to: request) }
        let url = request.url ?? BundledSite.home
        let fm = FileManager.default
        let file = BundledSite.file(forPath: url.path) { fm.fileExists(atPath: siteRoot.appendingPathComponent($0).path) }
        guard let file, let data = try? Data(contentsOf: siteRoot.appendingPathComponent(file)) else {
            return (Self.response(url, status: 404, type: "text/plain; charset=utf-8", length: 0), Data())
        }
        return (Self.response(url, status: 200, type: BundledSite.mimeType(forPath: file), length: data.count), data)
    }

    static func response(_ url: URL, status: Int, type: String, length: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type, "Content-Length": "\(length)", "Cache-Control": "no-cache",
        ])!
    }
}
