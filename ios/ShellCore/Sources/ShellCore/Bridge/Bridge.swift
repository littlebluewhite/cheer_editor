// 橋：網頁和殼之間說的話（#375）。說了什麼寫在 repo 根目錄的 bridge-scenarios/（兩邊的測試跑同一份）；
// 怎麼傳（messageHandlers、自訂網址）只有 App 的 WebShell 和 Resources/bridge.js 知道。
//
// 網頁 → 殼：{"name": "...", "body": ...}，殼回 {"reply": ...} 或 {"error": "unknown" | "failed" | "bad message"}。
// 殼 → 網頁：eventScript(name:body:) 包成一行 JS，網頁用 __cheerShell.on(name, fn) 收。
// 一開始：boot（殼的版本、建置號、會什麼，加上每一塊自己要塞的）。
import Foundation

public enum BridgeAnswer: Equatable, Sendable {
    case reply(JSONValue)
    case error(String)
}

@MainActor
public struct Bridge {
    public let shellVersion: String
    /// 建置號（CFBundleVersion）：網頁的清單的 minShellBuild 比的就是這個（docs/deploy.md「網頁的清單」）。
    public let shellBuild: Int
    private let parts: [any BridgePart]
    private let byMessage: [String: any BridgePart]

    public init(shellVersion: String, shellBuild: Int, parts: [any BridgePart]) {
        self.shellVersion = shellVersion
        self.shellBuild = shellBuild
        self.parts = parts
        var byMessage: [String: any BridgePart] = [:]
        for part in parts {
            for name in part.messages {
                precondition(byMessage[name] == nil, "橋上有兩塊都接「\(name)」")
                byMessage[name] = part
            }
        }
        self.byMessage = byMessage
        precondition(Set(features).count == features.count, "橋上有兩塊是同一件事")
    }

    /// 殼會什麼（網頁的「問殼」can() 問的）。
    public var features: [String] { parts.compactMap(\.feature).sorted() }

    /// 一開始塞給網頁的那份。
    public var boot: [String: JSONValue] {
        var boot: [String: JSONValue] = [
            "shellVersion": .string(shellVersion),
            "shellBuild": .number(Double(shellBuild)),
            "features": .array(features.map(JSONValue.string)),
        ]
        for part in parts {
            boot.merge(part.boot) { _, _ in preconditionFailure("橋上一開始塞的東西有重複的名字") }
        }
        return boot
    }

    public func handle(name: String, body: JSONValue) async -> BridgeAnswer {
        guard let part = byMessage[name] else { return .error("unknown") }
        do { return .reply(try await part.handle(name: name, body: body)) }
        catch { return .error("failed") }
    }

    /// 網頁送來的 JSON 字串 → 回的 JSON 字串。
    public func handle(raw: String) async -> String {
        struct Message: Decodable { let name: String; let body: JSONValue? }
        guard let message = try? JSONDecoder().decode(Message.self, from: Data(raw.utf8)) else {
            return JSONValue.object(["error": "bad message"]).jsonString
        }
        switch await handle(name: message.name, body: message.body ?? .null) {
        case .reply(let value): return JSONValue.object(["reply": value]).jsonString
        case .error(let code): return JSONValue.object(["error": .string(code)]).jsonString
        }
    }

    /// 殼主動跟網頁說一句：交給 WKWebView 的 evaluateJavaScript。
    public nonisolated static func eventScript(name: String, body: JSONValue) -> String {
        "window.__cheerShell && window.__cheerShell.receive(\(JSONValue.object(["name": .string(name), "body": body]).jsonString))"
    }
}
