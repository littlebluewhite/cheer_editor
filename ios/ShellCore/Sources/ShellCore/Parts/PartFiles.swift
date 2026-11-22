// 存成檔案的那幾塊（草稿 #377、離線存放 #383）共用的：id 當檔名能不能用、有就刪、網頁送來的字串。
import Foundation

enum PartFiles {
    /// id 當檔名用：只收英數字、-、_，1 到 100 個字。
    static func isSafeName(_ id: String) -> Bool {
        (1...100).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    /// 有就刪；本來就沒有不算錯。
    static func remove(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    /// 網頁送來的 body 裡 key 那個字串；不是字串就丟 error。
    static func string(_ body: JSONValue, _ key: String, or error: Error) throws -> String {
        guard case .object(let o) = body, case .string(let s)? = o[key] else { throw error }
        return s
    }
}
