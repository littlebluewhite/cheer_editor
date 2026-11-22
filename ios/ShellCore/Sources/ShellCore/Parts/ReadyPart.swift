// 「好了」：網頁畫面出來以後跟殼說（#375，情境 bridge-scenarios/current/ready.json）。
// 殼自己更新網頁（#393）用它判斷新網頁打不打得開：換上後 10 秒內沒說就退回（ADR 0025）。
public struct ReadyPart: BridgePart {
    let onReady: @MainActor () -> Void

    public init(onReady: @escaping @MainActor () -> Void) {
        self.onReady = onReady
    }

    public var messages: Set<String> { ["ready"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        onReady()
        return .null
    }
}
