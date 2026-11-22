// 列印（#391，情境 bridge-scenarios/current/print.json）：八拍表、記一次全上表、總表的「列印」請殼叫出系統的列印畫面。
// 網頁說按的那顆鈕在網頁畫面上的哪裡（button，CSS px），iPad 上列印畫面從那裡跳出來；沒說或說不清楚就不給位置。
// 叫出畫面就回，不等印完。真的叫出畫面的在 App（App/Shell/Printer.swift），從 init 傳進來。⌘P 不經過這裡。
public struct PrintPart: BridgePart {
    let onPrint: @MainActor (PrintButton?) -> Void

    public init(onPrint: @escaping @MainActor (PrintButton?) -> Void) {
        self.onPrint = onPrint
    }

    public var feature: String? { "print" }
    public var messages: Set<String> { ["print"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        onPrint(Self.button(in: body))
        return .null
    }

    static func button(in body: JSONValue) -> PrintButton? {
        guard case .object(let o) = body, case .object(let b)? = o["button"],
              case .number(let x)? = b["x"], case .number(let y)? = b["y"],
              case .number(let w)? = b["width"], case .number(let h)? = b["height"] else { return nil }
        return PrintButton(x: x, y: y, width: w, height: h)
    }
}

/// 按的那顆鈕在網頁畫面上的位置（CSS px，跟 getBoundingClientRect 一樣）。
public struct PrintButton: Equatable, Sendable {
    public let x, y, width, height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
}
