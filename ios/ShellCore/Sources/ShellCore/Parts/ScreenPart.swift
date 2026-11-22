// 現在是哪一種畫面（#376，情境 bridge-scenarios/current/screen.json）：網頁換畫面時跟殼說，殼照 ScreenFeel 調回彈（字的放大只看畫面大小，不看是哪一種）。
// 網頁問 can("screen")；body 是 {"kind": "editor"} 或 {"kind": "page"}。
public enum ScreenKind: String, Sendable {
    /// 編輯畫面（「/」打開一支流程以後）：整頁不捲，不回彈。
    case editor
    /// 會捲的頁：首頁、使用說明、帳號…
    case page
}

public struct ScreenPart: BridgePart {
    struct UnknownKind: Error {}

    let onScreen: @MainActor (ScreenKind) -> Void

    public init(onScreen: @escaping @MainActor (ScreenKind) -> Void) {
        self.onScreen = onScreen
    }

    public var feature: String? { "screen" }
    public var messages: Set<String> { ["screen"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        guard case .object(let fields) = body, case .string(let raw)? = fields["kind"],
              let kind = ScreenKind(rawValue: raw) else { throw UnknownKind() }
        onScreen(kind)
        return .null
    }
}
