// 殼轉送到哪個網站（#380）。上架版只連自己的網站；開發版（Debug）可以用環境變數 CHEER_SITE_URL 連本機的伺服器
// （例：SIMCTL_CHILD_CHEER_SITE_URL=http://127.0.0.1:8080/ xcrun simctl launch …，ios/README.md）。
// 上架前的檢查在 #396。
import Foundation

public enum SiteAddress {
    /// 自己的網站（src/lib/old-site.ts 的 NEW_SITE_URL）。網域接好前（docs/deploy.md）這裡還連不到。
    public static let production = URL(string: "https://littlebluewhite.com/")!

    public static func pick(debug: Bool, override: String?) -> URL {
        guard debug, let override, let url = URL(string: override),
              ["http", "https"].contains(url.scheme ?? ""), url.host?.isEmpty == false else { return production }
        return url
    }
}
