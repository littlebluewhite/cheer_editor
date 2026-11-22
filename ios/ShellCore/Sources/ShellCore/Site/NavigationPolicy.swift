// 殼要守的規矩（#375）：網頁畫面只開 App 裡那包網頁；外面的連結一律交給 Safari（系統決定 mailto: 這類給誰開）。
import Foundation

public enum NavigationDecision: Equatable, Sendable {
    /// 在 App 的網頁畫面裡開。
    case allow
    /// 不在 App 裡開，交給系統（https 開 Safari）。
    case openOutside
    /// 不開。
    case block
}

public enum NavigationPolicy {
    static let outside: Set<String> = ["http", "https", "mailto", "tel", "sms"]

    public static func decide(_ url: URL) -> NavigationDecision {
        let scheme = url.scheme?.lowercased() ?? ""
        if isOwn(url) { return .allow }
        if scheme == "about" { return .allow }
        // blob:app://local/… 是這包網頁自己做的（下載、預覽）；別的來源的不開
        if scheme == "blob", let inner = URL(string: String(url.absoluteString.dropFirst("blob:".count))) {
            return isOwn(inner) ? .allow : .block
        }
        return outside.contains(scheme) ? .openOutside : .block
    }

    static func isOwn(_ url: URL) -> Bool {
        url.scheme?.lowercased() == BundledSite.scheme && url.host?.lowercased() == BundledSite.host
    }
}
