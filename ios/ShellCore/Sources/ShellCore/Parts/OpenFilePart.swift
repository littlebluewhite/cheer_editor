// 在 App 裡打開流程檔（#384，ADR 0024，情境 bridge-scenarios/current/openFile.json）。
// 殼不拆檔、不看內容：只把檔名和位元組（base64）交給網頁，網頁照開檔的規則打開（拆兩層、錯誤訊息、有沒存的修改先問）。
// - 「檔案」點 .cheer、分享選單交給 App 的（App 的 SceneDelegate 叫 handOver）：殼收著、說 fileOpened；網頁拿（takeOpenedFile），拿過就沒了，
//   重新載入（換上新網頁、行程當掉）不會又打開。App 剛打開時網頁一開始就先拿，拿到就不開上次那支。
// - App 裡按「開啟流程檔」（pickFlowFile）：App 叫出選檔畫面（pick），選了回那個檔，按取消回 null。
// 原地打開的檔是 security-scoped，用 NSFileCoordinator 讀（iCloud 還沒下載的會等它下載完）。存回原檔是 #385。
import Foundation

@MainActor
public final class OpenFilePart: BridgePart {
    private let outbox: ShellOutbox
    private let pick: @MainActor () async -> URL?
    private let read: @Sendable (URL) async throws -> Data
    /// 交給 App、網頁還沒拿的那個檔。
    private var held: URL?

    /// pick：叫出選檔畫面，選了回網址、取消回 nil。read：讀那個檔（預設照原地打開的檔讀）。
    public init(
        outbox: ShellOutbox = ShellOutbox(),
        pick: @escaping @MainActor () async -> URL? = { nil },
        read: @escaping @Sendable (URL) async throws -> Data = OpenFilePart.readInPlace
    ) {
        self.outbox = outbox
        self.pick = pick
        self.read = read
    }

    /// 「檔案」、分享選單把一個檔交給 App：收著（網頁還沒拿又來一個，換成新的），跟網頁說一聲。
    public func handOver(_ url: URL) {
        held = url
        outbox.emit("fileOpened", nil)
    }

    public var feature: String? { "openFile" }
    public var messages: Set<String> { ["takeOpenedFile", "pickFlowFile"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        let url: URL?
        if name == "takeOpenedFile" {
            url = held
            held = nil
        } else {
            url = await pick()
        }
        guard let url else { return nil }
        return ["name": .string(url.lastPathComponent), "bytes": .string(try await read(url).base64EncodedString())]
    }

    /// 讀原地打開的檔（「檔案」、選檔畫面給的是 security-scoped 網址；分享選單給的副本不是，照樣讀得到）。不在主執行緒上讀。
    @Sendable
    public nonisolated static func readInPlace(_ url: URL) async throws -> Data {
        try await Task.detached {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            var failure: NSError?
            var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) { at in
                result = Result { try Data(contentsOf: at) }
            }
            if let failure { throw failure }
            return try result.get()
        }.value
    }
}
