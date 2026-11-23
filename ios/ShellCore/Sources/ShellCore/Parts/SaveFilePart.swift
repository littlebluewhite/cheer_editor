// 存檔蓋回原本的檔、「傳給別人」（#385，情境 bridge-scenarios/current/saveFile.json）。
// - 存檔（saveFlowFile）：網頁給「存到哪」（target：殼給過的書籤，base64）就蓋回那個檔；沒給、書籤找不到檔、寫不進去，就問存到哪
//   （askWhere：App 叫出系統的存檔畫面，存好回那個檔的網址；按取消 nil），回新的書籤和檔名。按取消回 null。
//   書籤殼不留：網頁跟草稿一起記（小設定），App 關掉再開照樣交回來。書籤舊了（檔搬過）回新的。
// - 傳給別人（shareFlowFile）：叫出分享選單送那個檔（.zip），回有沒有送出。button 是按的那顆鈕（iPad 的分享選單從那裡跳出來）。
// 「檔案」點進來、「開啟流程檔」選的檔，書籤是 OpenFilePart 交檔時一起給的；分享選單給的副本沒有。
import Foundation

/// 檔放在哪：記成書籤、從書籤找回來、寫進去。App 用 inPlace（原地打開的檔）；情境測試換成假的。
public struct FilePlaces: Sendable {
    /// 記下這個檔在哪（書籤）；記不了是 nil。
    public let remember: @Sendable (URL) -> Data?
    /// 從書籤找回那個檔；stale = 書籤舊了，要記一份新的。找不到是 nil。
    public let find: @Sendable (Data) -> (url: URL, stale: Bool)?
    /// 把位元組寫進那個檔（蓋掉原本的）。
    public let write: @Sendable (Data, URL) async throws -> Void

    public init(
        remember: @escaping @Sendable (URL) -> Data?,
        find: @escaping @Sendable (Data) -> (url: URL, stale: Bool)?,
        write: @escaping @Sendable (Data, URL) async throws -> Void
    ) {
        self.remember = remember
        self.find = find
        self.write = write
    }

    /// 原地打開的檔（「檔案」、選檔畫面、存檔畫面給的是 security-scoped 網址）：iOS 沒有 .withSecurityScope，
    /// 先 startAccessingSecurityScopedResource 再用預設的選項記書籤。寫用 NSFileCoordinator（.forReplacing），不在主執行緒上寫。
    public static let inPlace = FilePlaces(
        remember: { url in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try? url.bookmarkData()
        },
        find: { data in
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale) else { return nil }
            return (url, stale)
        },
        write: { bytes, url in
            try await Task.detached {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                var failure: NSError?
                var result: Result<Void, Error> = .failure(CocoaError(.fileWriteUnknown))
                NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &failure) { at in
                    // 只蓋掉存在的檔：檔被刪了就不在原地方重建一個，改問存到哪
                    result = Result {
                        guard FileManager.default.fileExists(atPath: at.path) else { throw CocoaError(.fileNoSuchFile) }
                        try bytes.write(to: at)
                    }
                }
                if let failure { throw failure }
                try result.get()
            }.value
        }
    )
}

enum SaveFileError: Error { case badBody }

@MainActor
public final class SaveFilePart: BridgePart {
    private let askWhere: @MainActor (String, Data) async -> URL?
    private let share: @MainActor (String, Data, PrintButton?) async -> Bool
    private let places: FilePlaces

    /// askWhere：問存到哪（建議的檔名、位元組），存好回那個檔、取消回 nil。share：叫出分享選單送那個檔，回有沒有送出。
    public init(
        askWhere: @escaping @MainActor (String, Data) async -> URL?,
        share: @escaping @MainActor (String, Data, PrintButton?) async -> Bool = { _, _, _ in false },
        places: FilePlaces = .inPlace
    ) {
        self.askWhere = askWhere
        self.share = share
        self.places = places
    }

    public var feature: String? { "saveFile" }
    public var messages: Set<String> { ["saveFlowFile", "shareFlowFile"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        let fileName = try PartFiles.string(body, "name", or: SaveFileError.badBody)
        guard let bytes = Data(base64Encoded: try PartFiles.string(body, "bytes", or: SaveFileError.badBody)) else { throw SaveFileError.badBody }
        if name == "shareFlowFile" {
            return .bool(await share(fileName, bytes, PrintPart.button(in: body)))
        }
        if case .object(let o) = body, case .string(let target)? = o["target"],
           let mark = Data(base64Encoded: target), let found = places.find(mark),
           (try? await places.write(bytes, found.url)) != nil {
            let fresh = found.stale ? places.remember(found.url)?.base64EncodedString() ?? target : target
            return ["target": .string(fresh), "name": .string(found.url.lastPathComponent)]
        }
        guard let url = await askWhere(fileName, bytes) else { return nil }
        return ["target": places.remember(url).map { .string($0.base64EncodedString()) } ?? .null, "name": .string(url.lastPathComponent)]
    }
}
