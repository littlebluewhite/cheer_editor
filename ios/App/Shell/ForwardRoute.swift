// 殼代網頁上網（#380，ADR 0023）：app://local/api/… 轉到自己的網站。規則在 ShellCore 的 Forwarder、CookieJar；
// 這裡只接系統：URLSession（不用系統的 cookie、快取，不跟轉址）、cookie 存在 App 自己的資料夾（網頁讀不到）。
import Foundation
import ShellCore

@MainActor
enum AppSite {
    /// 殼轉到哪個網站。Debug 版可以用環境變數 CHEER_SITE_URL 連本機的伺服器；上架版一定是自己的網站。
    static let current: URL = {
        #if DEBUG
        SiteAddress.pick(debug: true, override: ProcessInfo.processInfo.environment["CHEER_SITE_URL"])
        #else
        SiteAddress.pick(debug: false, override: nil)
        #endif
    }()

    /// 殼的 cookie 罐子：一個網站一份，存在 Application Support（不進備份以外的地方，網頁碰不到）。
    static func jar(site: URL) -> CookieJar {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let host = site.host ?? "site"
        let file = dir.appendingPathComponent("cookies-\(host)-\(site.port ?? 0).json")
        return CookieJar(site: site, load: { try? Data(contentsOf: file) }, save: { data in
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        })
    }
}

@MainActor
struct ForwardRoute: SchemeRoute {
    let forwarder: Forwarder

    init(site: URL = AppSite.current, jar: CookieJar? = nil) {
        forwarder = Forwarder(site: site, jar: jar ?? AppSite.jar(site: site), send: ForwardRoute.send)
    }

    func handles(_ request: URLRequest) -> Bool { Forwarder.handles(request) }

    func respond(to request: URLRequest) async throws -> (HTTPURLResponse, Data) {
        try await forwarder.forward(request)
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()

    private static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// 不跟轉址：轉址的回應照樣交給網頁。殼帶的 Cookie 不會跟著跑到別的網址。
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? { nil }
}
