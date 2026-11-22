// App 這邊接「殼自己從網站更新網頁」（#393、ADR 0025）。規則在 ShellCore 的 WebUpdater；這裡只接 UIKit、WebKit：
// - App 打開、回到前景時去網站看（WebUpdatePart.check）；
// - 換上的那包由 WebBundleRoute 送（登記在 SchemeRoutes.swift，排在 /api/ 那幾條後面）；
// - 網頁說「好了」（ShellParts.swift 的 ReadyPart）、網頁的行程當掉，交給 WebUpdater 決定留著還是退回；
// - 換上、退回都是同一個網頁畫面重新載入首頁：來源還是 app://local，網頁存的東西（草稿、小設定）都在。
import ShellCore
import UIKit
import WebKit

@MainActor
final class WebUpdates {
    /// 上架版只從自己的網站抓（寫死）。開發版改抓 Mac 上的小網站是 #394。
    static let site = URL(string: "https://littlebluewhite.com")!

    let updater: WebUpdater
    let part: WebUpdatePart
    let route: WebBundleRoute
    private var observers: [NSObjectProtocol] = []

    /// autoCheck：打開、回到前景時自己去網站看。測試裡（App 被 PipeTests 帶起來時）不看，免得連到正式站。
    init(context: ShellContext, site: URL = WebUpdates.site, root: URL = WebUpdates.defaultRoot,
         bundled: URL, autoCheck: Bool = !WebUpdates.underTest) {
        let reload: @MainActor () -> Void = { [weak context] in
            // 先讓橋把這句的回覆送回去，再換頁
            DispatchQueue.main.async { context?.webView?.load(URLRequest(url: BundledSite.home)) }
        }
        updater = WebUpdater(site: site, root: root, bundled: bundled, fetch: SiteFetcher(site: site).get, rolledBack: reload)
        part = WebUpdatePart(updater: updater, outbox: context.outbox, reload: reload)
        route = WebBundleRoute(updater: updater)
        updater.launch()

        observers.append(NotificationCenter.default.addObserver(
            forName: WebShell.webContentProcessDidTerminate, object: nil, queue: .main
        ) { [weak self, weak context] note in
            MainActor.assumeIsolated {
                guard let webView = note.object as? WKWebView, webView === context?.webView else { return }
                _ = self?.updater.webCrashed()  // 退回的話 rolledBack 會重新載入
            }
        })
        guard autoCheck else { return }
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        })
        check()
    }

    func check() {
        Task { await part.check() }
    }

    /// Application Support/WebBundles：不進 iCloud 備份（隨時可以從網站再抓）。
    static var defaultRoot: URL {
        var url = URL.applicationSupportDirectory.appendingPathComponent("WebBundles", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }

    static var underTest: Bool { ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil }

    // 一個 ShellContext 一個（ShellParts、SchemeRoutes 各自拿同一個）
    private static var byContext: [ObjectIdentifier: WebUpdates] = [:]

    static func of(_ context: ShellContext) -> WebUpdates {
        if let found = byContext[ObjectIdentifier(context)] { return found }
        // App 裡附的那包（ShellViewController 找不到就不會建橋）
        let bundled = Bundle.main.url(forResource: "Web", withExtension: "bundle") ?? Bundle.main.bundleURL
        let made = WebUpdates(context: context, bundled: bundled)
        byContext[ObjectIdentifier(context)] = made
        return made
    }
}

extension ShellContext {
    var webUpdates: WebUpdates { WebUpdates.of(self) }
}

/// 換上了下載的那包時，app://local/ 的網頁檔從那包送（對檔的規則跟 SchemeHandler 一樣，BundledSite）。
struct WebBundleRoute: SchemeRoute {
    let updater: WebUpdater

    func handles(_ request: URLRequest) -> Bool { updater.servingRoot != nil }

    func respond(to request: URLRequest) async -> (HTTPURLResponse, Data) {
        let url = request.url ?? BundledSite.home
        guard let root = updater.servingRoot else {
            return (SchemeHandler.response(url, status: 404, type: "text/plain; charset=utf-8", length: 0), Data())
        }
        let fm = FileManager.default
        let file = BundledSite.file(forPath: url.path) { fm.fileExists(atPath: root.appendingPathComponent($0).path) }
        guard let file, let data = try? Data(contentsOf: root.appendingPathComponent(file)) else {
            return (SchemeHandler.response(url, status: 404, type: "text/plain; charset=utf-8", length: 0), Data())
        }
        return (SchemeHandler.response(url, status: 200, type: BundledSite.mimeType(forPath: file), length: data.count), data)
    }
}

/// 網頁的行程當掉（WKNavigationDelegate；WebShell 是網頁畫面的 navigationDelegate）。WebUpdates 聽這個決定要不要退回。
extension WebShell {
    static let webContentProcessDidTerminate = Notification.Name("WebShell.webContentProcessDidTerminate")

    @objc func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NotificationCenter.default.post(name: Self.webContentProcessDidTerminate, object: webView)
    }
}
