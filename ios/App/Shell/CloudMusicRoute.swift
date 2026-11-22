// 雲端流程的音樂經過殼（#382）：app://local/cloud-music?url=<預簽網址> 直接送到 R2。規則在 ShellCore 的 CloudMusic；
// 這裡只接系統：URLSession（不用系統的 cookie、快取，不跟轉址）。Debug 版准本機的假 R2（管子測試、開發）。
import Foundation
import ShellCore

@MainActor
struct CloudMusicRoute: SchemeRoute {
    #if DEBUG
    let allowLocal = true
    #else
    let allowLocal = false
    #endif

    func handles(_ request: URLRequest) -> Bool { CloudMusic.handles(request) }

    func respond(to request: URLRequest) async throws -> (HTTPURLResponse, Data) {
        try await CloudMusic.relay(request, allowLocal: allowLocal, send: Self.send)
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: RefuseRedirects(), delegateQueue: nil)
    }()

    private static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// 不跟轉址：R2 的預簽網址不會轉址，轉了就當 R2 回的交給網頁。
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? { nil }
}
