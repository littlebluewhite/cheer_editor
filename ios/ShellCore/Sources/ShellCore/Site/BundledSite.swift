// 包在 App 裡的網頁（ADR 0022）：用自訂網址 app://local/ 開，不連到網站。
// 這個來源（app://local）是網頁存資料（IndexedDB、localStorage）的地方：換了，網頁存的東西就找不回來，不要改。
// 對檔的規則跟網站的伺服器一樣（server/src/lib.rs）：/guide → guide.html；沒建好的頁面給 200.html，網頁自己處理路由。
import Foundation

public enum BundledSite {
    public static let scheme = "app"
    public static let host = "local"
    public static let home = URL(string: "app://local/")!

    /// 網址的路徑對到這包網頁裡的哪個檔（相對路徑）；沒有就 nil（回 404）。
    public static func file(forPath path: String, exists: (String) -> Bool) -> String? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        if parts.contains(where: { $0 == ".." || $0 == "." }) { return nil }
        let relative = parts.joined(separator: "/")
        if relative.isEmpty { return "index.html" }
        if exists(relative) { return relative }
        if exists(relative + ".html") { return relative + ".html" }
        if (relative as NSString).pathExtension.isEmpty, exists("200.html") { return "200.html" }
        return nil
    }

    public static func mimeType(forPath path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json"
        case "webmanifest": "application/manifest+json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "webp": "image/webp"
        case "ico": "image/x-icon"
        case "wasm": "application/wasm"
        case "txt": "text/plain; charset=utf-8"
        case "woff2": "font/woff2"
        case "wav": "audio/wav"
        case "mp3": "audio/mpeg"
        default: "application/octet-stream"
        }
    }
}
