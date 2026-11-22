// 雲端流程的音樂經過殼（#382，ADR 0023）：R2 只放行網站的網址（CORS），app://local 的網頁直接 fetch R2 過不了，R2 的設定不改。
// 網頁照舊跟伺服器（/api/，#380 轉送）拿預簽網址，再 fetch('/cloud-music?url=<預簽網址>')，殼照那個網址直接送到 R2。
// - 只送到 R2（https://*.r2.cloudflarestorage.com）；開發版（allowLocal）也准本機 http://127.0.0.1 的假 R2。只有 GET、PUT。
// - 不帶網頁的 header、不帶殼的 cookie（預簽網址只簽了 host，什麼都不用帶），不跟轉址。
// - 斷線就丟錯誤：網頁的 fetch 失敗（ServerUnreachable），畫面照網頁版說傳不上、拿不到。
// 網頁送 File 的內容到不了殼（ios/README.md「POST 進不進得了殼」）：網頁先轉成 ArrayBuffer。
import Foundation

public enum CloudMusic {
    public typealias Send = @MainActor (URLRequest) async throws -> (Data, HTTPURLResponse)

    public static let path = "/cloud-music"
    static let r2Suffix = ".r2.cloudflarestorage.com"

    /// app://local/cloud-music 才接。
    public static func handles(_ request: URLRequest) -> Bool {
        guard let url = request.url, url.scheme == BundledSite.scheme, url.host == BundledSite.host else { return false }
        return url.path == path
    }

    /// 要送到哪：網頁給的預簽網址，不是 R2（或方法不對）是 nil。
    public static func target(of request: URLRequest, allowLocal: Bool) -> URL? {
        guard handles(request), ["GET", "PUT"].contains(request.httpMethod ?? "GET"),
              let url = request.url, let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                  .queryItems?.first(where: { $0.name == "url" })?.value,
              let to = URL(string: raw), let host = to.host?.lowercased() else { return nil }
        if to.scheme == "https" && host.hasSuffix(r2Suffix) { return to }
        if allowLocal && to.scheme == "http" && host == "127.0.0.1" { return to }
        return nil
    }

    /// 照預簽網址送，回給網頁的回應（網址是網頁原本的；只留 Content-Type）。
    @MainActor
    public static func relay(_ request: URLRequest, allowLocal: Bool, send: Send) async throws -> (HTTPURLResponse, Data) {
        guard let from = request.url, let to = target(of: request, allowLocal: allowLocal) else { throw URLError(.unsupportedURL) }
        var out = URLRequest(url: to)
        out.httpMethod = request.httpMethod ?? "GET"
        out.httpBody = request.httpBody
        let (data, response) = try await send(out)
        var headers = ["Content-Length": "\(data.count)"]
        if let type = response.value(forHTTPHeaderField: "Content-Type") { headers["Content-Type"] = type }
        return (HTTPURLResponse(url: from, statusCode: response.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!, data)
    }
}

/// 一開始告訴網頁殼會代傳音樂（情境 bridge-scenarios/current/cloudMusic.json）：網頁問 can("cloudMusic")，
/// 會才走 /cloud-music（網站更新的新網頁碰上還不會的舊殼時，照網頁版直接連 R2）。
public struct CloudMusicPart: BridgePart {
    public init() {}
    public var feature: String? { "cloudMusic" }
}
