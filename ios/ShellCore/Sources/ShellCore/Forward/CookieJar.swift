// 殼的 cookie 罐子（#380）：只放自己網站的 cookie（登入狀態 __Host-id），網頁讀不到。
// 不用系統的 HTTPCookieStorage：它不收 http 送來的 Secure cookie，開發時連本機的 http 伺服器就登不進去。
// 這裡一律當成 https 解析（系統的 HTTPCookie 解析 Max-Age、Expires），存成 名字 → 值、到期時間。
// 存在哪由 App 決定（load、save）：關掉再開還在，30 天內不用再登入。
import Foundation

@MainActor
public final class CookieJar {
    struct Kept: Codable, Equatable {
        var value: String
        var expires: Date?
    }

    private let site: URL
    private let save: (Data) -> Void
    private var cookies: [String: Kept]

    public init(site: URL, load: () -> Data?, save: @escaping (Data) -> Void) {
        self.site = site
        self.save = save
        cookies = load().flatMap { try? JSONDecoder().decode([String: Kept].self, from: $0) } ?? [:]
    }

    /// 送給網站的 Cookie 標頭；沒有是 nil。
    public func header(now: Date = Date()) -> String? {
        let live = cookies.filter { $0.value.expires.map { $0 > now } ?? true }
        guard !live.isEmpty else { return nil }
        return live.keys.sorted().map { "\($0)=\(live[$0]!.value)" }.joined(separator: "; ")
    }

    /// 網站回的標頭裡的 Set-Cookie 收起來（Max-Age=0 就是刪掉）。
    public func take(setCookie headers: [String: String], now: Date = Date()) {
        var secure = URLComponents(url: site, resolvingAgainstBaseURL: false)!
        secure.scheme = "https"
        guard let url = secure.url else { return }
        let got = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        guard !got.isEmpty else { return }
        for c in got where c.domain == site.host {
            if let expires = c.expiresDate, expires <= now {
                cookies[c.name] = nil
            } else {
                cookies[c.name] = Kept(value: c.value, expires: c.expiresDate)
            }
        }
        if let data = try? JSONEncoder().encode(cookies) { save(data) }
    }
}
