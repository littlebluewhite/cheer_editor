// 橋上「殼自己更新網頁」這一塊（#393，情境 bridge-scenarios/current/web-update.json）：
// 殼下載好新網頁就跟網頁說 webBundleReady；網頁回到首頁時說 useNewWebBundle，殼換上、重新載入。
// #394 的「更新」按鈕也說 useNewWebBundle。網頁用 can("webUpdate") 問殼會不會。
public struct WebUpdatePart: BridgePart {
    let updater: WebUpdater
    let outbox: ShellOutbox
    let reload: @MainActor () -> Void

    /// reload：換上了，App 重新載入網頁（同一個網頁畫面，網頁存的東西都在）。
    public init(updater: WebUpdater, outbox: ShellOutbox, reload: @escaping @MainActor () -> Void) {
        self.updater = updater
        self.outbox = outbox
        self.reload = reload
    }

    public var feature: String? { "webUpdate" }
    public var messages: Set<String> { ["useNewWebBundle"] }

    /// 換上下載好的那包：回 true（接著重新載入）；沒有下載好的回 false。
    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        guard updater.useNew() else { return false }
        reload()
        return true
    }

    /// 去網站看；有下載好的（剛下載完，或之前下載好還沒換）就跟網頁說。App 打開、回到前景時叫。
    public func check() async {
        if case .downloaded = await updater.check() { outbox.emit("webBundleReady") }
    }
}
