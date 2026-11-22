// 橋的一塊：一件事一個檔（例：Parts/ReadyPart.swift），在 App 的 ShellParts.swift 和測試的 ScenarioParts.swift 各登記一行。
// 規則寫在這裡（不碰畫面）；要碰畫面、系統的（列印、播放鍵…）由 App 傳進來（例：ReadyPart 的 onReady）。

@MainActor
public protocol BridgePart {
    /// 網頁用「問殼」can(feature) 問得到的名字。nil：底層的管子，不算一件「會的事」。
    var feature: String? { get }
    /// 這一塊接的話（網頁送來的名字）。
    var messages: Set<String> { get }
    /// 一開始（document start）併進塞給網頁的那份。key 不能跟別塊重複。
    var boot: [String: JSONValue] { get }
    /// 網頁送來 messages 裡的一句，回一個值（沒東西回就 nil）。丟錯誤的話網頁收到 failed。
    func handle(name: String, body: JSONValue) async throws -> JSONValue
}

public extension BridgePart {
    var feature: String? { nil }
    var messages: Set<String> { [] }
    var boot: [String: JSONValue] { [:] }
    func handle(name: String, body: JSONValue) async throws -> JSONValue { .null }
}
