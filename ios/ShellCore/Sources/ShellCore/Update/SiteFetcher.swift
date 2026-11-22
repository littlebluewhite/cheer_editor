// 殼從自己的網站抓網頁（#393）：不用快取、不帶 cookie；網站轉到別的地方（別的網站、http）就不跟。
import Foundation

public final class SiteFetcher: NSObject, URLSessionTaskDelegate, Sendable {
    private let site: URL
    private let session: URLSession

    public init(site: URL) {
        self.site = site
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
        super.init()
    }

    /// 抓一個網址；不是 2xx 就丟錯。
    public func get(_ url: URL) async throws -> Data {
        guard Self.follows(url, site: site) else { throw URLError(.badURL) }
        let (data, response) = try await session.data(from: url, delegate: self)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }

    /// 這個網址是不是自己的網站（scheme、host、port 都一樣）。
    public static func follows(_ url: URL, site: URL) -> Bool {
        url.scheme == site.scheme && url.host == site.host && url.port == site.port
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest) async -> URLRequest? {
        guard let url = request.url, Self.follows(url, site: site) else { return nil }
        return request
    }
}
