// 殼代網頁上網（#380，ADR 0023）：網頁照舊 fetch('/api/…')，在 App 裡變成 app://local/api/…，殼轉到自己的網站。
// - 只轉 app://local/api/ 底下的，只轉到自己的網站（site）；伺服器以後加新 API 不用改殼。
// - 送的時候標上網站自己的網址（Origin），伺服器的同網址檢查（server/src/csrf.rs）不用改。
//   網頁帶來的 Origin、Referer、Cookie、Sec-Fetch-* 都拿掉（csrf.rs 先看 Sec-Fetch-Site）。
// - 登入 cookie 在殼的 CookieJar 裡：回給網頁的不帶 Set-Cookie，網頁讀不到。
// - 連不上就丟錯誤：網頁的 fetch 失敗（ServerUnreachable），不會當成「沒登入」。
// 網頁送 Blob／File 的內容到不了殼（ios/README.md「POST 進不進得了殼」）：要轉的內容先轉成 ArrayBuffer 或字串。
import Foundation

@MainActor
public final class Forwarder {
    public typealias Send = @MainActor (URLRequest) async throws -> (Data, HTTPURLResponse)

    public let site: URL
    public let jar: CookieJar
    private let send: Send

    public init(site: URL, jar: CookieJar, send: @escaping Send) {
        self.site = site
        self.jar = jar
        self.send = send
    }

    /// 網站自己的網址（例：https://littlebluewhite.com），送出時的 Origin。
    public var origin: String { Self.origin(of: site) }

    public nonisolated static func origin(of site: URL) -> String {
        var c = URLComponents()
        c.scheme = site.scheme
        c.host = site.host
        c.port = site.port
        return c.string ?? ""
    }

    /// 這個請求要不要轉：app://local/api/ 底下的才轉。
    public nonisolated static func handles(_ request: URLRequest) -> Bool {
        guard let url = request.url, url.scheme == BundledSite.scheme, url.host == BundledSite.host else { return false }
        let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? ""
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        return path.hasPrefix("/api/") && !parts.contains(where: { $0 == ".." || $0 == "." })
    }

    /// 網頁的請求轉到網站，回給網頁的回應（網址是網頁原本的，沒有 Set-Cookie）。
    public func forward(_ request: URLRequest) async throws -> (HTTPURLResponse, Data) {
        guard Self.handles(request), let from = request.url else { throw URLError(.unsupportedURL) }
        var out = URLRequest(url: target(for: from))
        out.httpMethod = request.httpMethod
        out.httpBody = request.httpBody
        for (name, value) in request.allHTTPHeaderFields ?? [:] where Self.keepsFromWeb(name) {
            out.setValue(value, forHTTPHeaderField: name)
        }
        out.setValue(origin, forHTTPHeaderField: "Origin")
        if let cookie = jar.header() { out.setValue(cookie, forHTTPHeaderField: "Cookie") }

        let (data, response) = try await send(out)
        jar.take(setCookie: response.allHeaderFields.reduce(into: [:]) { all, field in
            if let k = field.key as? String, let v = field.value as? String { all[k] = v }
        })
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String, let value = value as? String, Self.keepsFromSite(name) else { continue }
            headers[name] = value
        }
        headers["Content-Length"] = "\(data.count)"
        let back = HTTPURLResponse(url: from, statusCode: response.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (back, data)
    }

    private func target(for url: URL) -> URL {
        let from = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var c = URLComponents(url: site, resolvingAgainstBaseURL: false)!
        c.percentEncodedPath = from?.percentEncodedPath ?? "/"
        c.percentEncodedQuery = from?.percentEncodedQuery
        c.fragment = nil
        return c.url!
    }

    private nonisolated static func keepsFromWeb(_ name: String) -> Bool {
        let n = name.lowercased()
        return !["origin", "referer", "cookie", "host", "content-length"].contains(n) && !n.hasPrefix("sec-fetch-")
    }

    /// 回應給網頁時拿掉的：Set-Cookie（cookie 留在殼裡）；內容已經解壓過，壓縮和長度不照網站說的。
    private nonisolated static func keepsFromSite(_ name: String) -> Bool {
        !["set-cookie", "set-cookie2", "content-encoding", "content-length"].contains(name.lowercased())
    }
}
