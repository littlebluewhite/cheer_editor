// 網站的網址（#380，情境 bridge-scenarios/current/network.json）：一開始告訴網頁殼轉到哪個網站。
// 網頁用它做分享連結、連雲端流程（host().siteUrl，src/lib/app-site.ts）；App 裡的 location.href 是 app://local/，別人打不開。
import Foundation

public struct SitePart: BridgePart {
    let site: URL

    public init(site: URL) {
        self.site = site
    }

    public var boot: [String: JSONValue] { ["siteUrl": .string(site.absoluteString)] }
}
