// 橋上「殼自己更新網頁」這一塊（#393、#394，情境 bridge-scenarios/current/web-update.json）：
// - 殼下載好新網頁就跟網頁說 webBundleReady；網頁回到首頁時說 useNewWebBundle，殼換上、重新載入首頁。
// - 雲端流程被擋（有新版）時網頁問 checkWebBundle：新網頁好了沒、殼太不太舊（清單的 minShellBuild）。
// - 「更新」按鈕說 updateWebBundle（帶開著的雲端流程代號）：還沒下載就先抓，抓好馬上換、重新載入回到同一支流程。
// 網頁用 can("webUpdate") 問殼會不會。
import Foundation

public struct WebUpdatePart: BridgePart {
    let updater: WebUpdater
    let outbox: ShellOutbox
    let reload: @MainActor (URL) -> Void

    /// reload：換上了，App 重新載入網頁到這個網址（同一個網頁畫面，網頁存的東西都在）。
    public init(updater: WebUpdater, outbox: ShellOutbox, reload: @escaping @MainActor (URL) -> Void) {
        self.updater = updater
        self.outbox = outbox
        self.reload = reload
    }

    public var feature: String? { "webUpdate" }
    public var messages: Set<String> { ["useNewWebBundle", "checkWebBundle", "updateWebBundle"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        switch name {
        case "checkWebBundle":
            // 回 "ready"（下載好了）、"tooOld"（要比自己新的殼）、"none"（沒有新的、抓不到）
            return .string(Self.answer(await updater.latest()))
        case "updateWebBundle":
            // 回 "updated"（換上了，接著重新載入）、"tooOld"、"none"
            // 網站這次沒連上，但之前下載好的還在：照樣換
            if case .tooOld = await updater.latest() { return "tooOld" }
            guard updater.useNew() else { return "none" }
            var flow: String?
            if case .object(let o) = body, case .string(let s)? = o["flow"] { flow = s }
            reload(Self.back(to: flow))
            return "updated"
        default:
            // useNewWebBundle：換上下載好的那包，回 true（接著重新載入首頁）；沒有下載好的回 false
            guard updater.useNew() else { return false }
            reload(BundledSite.home)
            return true
        }
    }

    /// 去網站看；有下載好的（剛下載完，或之前下載好還沒換）就跟網頁說。App 打開、回到前景時叫。
    public func check() async {
        if case .downloaded = await updater.check() { outbox.emit("webBundleReady") }
    }

    private static func answer(_ result: WebUpdater.CheckResult) -> String {
        switch result {
        case .downloaded: "ready"
        case .tooOld: "tooOld"
        default: "none"
        }
    }

    /// 換完回到哪裡：有雲端流程代號就是首頁加 ?cloud=<代號>（網頁打開那支），沒有就是首頁。
    static func back(to flow: String?) -> URL {
        guard let flow, !flow.isEmpty else { return BundledSite.home }
        var parts = URLComponents(url: BundledSite.home, resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "cloud", value: flow)]
        return parts.url ?? BundledSite.home
    }
}
