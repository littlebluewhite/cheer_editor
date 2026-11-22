// 草稿存在殼裡（#377，規格 #360「資料存在哪、網頁怎麼拿到」）：網頁的草稿存放（src/lib/shell-drafts.ts）問殼，
// 殼把每份草稿存成資料夾裡的一個檔：<草稿 id>.zip，就是整包流程檔（含音樂）。存的時間記成檔的修改時間。
// App 裡的資料夾是 Application Support/Drafts（不標成不備份，會進 iCloud 備份）；說的話在 bridge-scenarios/current/drafts.json。
// 留幾支、丟哪支照網頁版（src/lib/flow-file.svelte.ts），殼只存、讀、列、清。
//
// 怎麼傳：base64 放在橋的 JSON 裡（messageHandlers）。iOS 27.2 模擬器上 60 MB 存一次約 0.2 秒、讀一次約 0.3 秒（ios/README.md「草稿」）。
import Foundation

public struct DraftFolder: Sendable {
    public let root: URL
    let now: @Sendable () -> Date

    public init(root: URL, now: @escaping @Sendable () -> Date = Date.init) {
        self.root = root
        self.now = now
    }

    /// App 的草稿資料夾：Application Support/Drafts（不在 tmp、Caches，系統不會清；會進 iCloud 備份）。
    public static func inApplicationSupport() -> DraftFolder {
        DraftFolder(root: URL.applicationSupportDirectory.appendingPathComponent("Drafts", isDirectory: true))
    }

    /// 草稿 id 當檔名用：只收網頁做得出來的那種（n…、f…-…、舊版的 current）。
    static func isDraftId(_ id: String) -> Bool {
        (1...100).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    func file(_ id: String) throws -> URL {
        guard Self.isDraftId(id) else { throw DraftError.badId }
        return root.appendingPathComponent("\(id).zip")
    }

    func list() throws -> [(id: String, savedAt: Date)] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return try names.sorted().compactMap { name in
            guard name.hasSuffix(".zip") else { return nil }
            let id = String(name.dropLast(4))
            guard Self.isDraftId(id) else { return nil }
            return (id, try savedAt(root.appendingPathComponent(name)))
        }
    }

    func load(_ id: String) throws -> (bytes: Data, savedAt: Date)? {
        let url = try file(id)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return (try Data(contentsOf: url), try savedAt(url))
    }

    /// 整個寫好才換上去：寫到一半被系統關掉，舊的那份還在。
    func save(_ id: String, _ bytes: Data) throws {
        let url = try file(id)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try bytes.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.modificationDate: now()], ofItemAtPath: url.path)
    }

    func clear(_ id: String) throws {
        let url = try file(id)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    private func savedAt(_ url: URL) throws -> Date {
        try url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast
    }
}

enum DraftError: Error { case badId, badBody }

public struct DraftsPart: BridgePart {
    let folder: DraftFolder
    let outbox: ShellOutbox
    /// 存的時候叫：App 傳「跟系統要一點背景時間」，回傳放手的函式（切到背景那一下存的草稿才寫得完）。
    let keepAlive: @MainActor () -> (() -> Void)

    public init(folder: DraftFolder, outbox: ShellOutbox = ShellOutbox(), keepAlive: @escaping @MainActor () -> (() -> Void) = { {} }) {
        self.folder = folder
        self.outbox = outbox
        self.keepAlive = keepAlive
    }

    /// App 要切到背景（滑到 App 切換器、接著可能被滑掉）：跟網頁說，網頁馬上把還沒進草稿的改動存起來。
    /// WKWebView 這時不一定發 visibilitychange（iOS 27.2 模擬器上 PipeTests 量過沒發）。
    public func appGoingAway() {
        outbox.emit("background", nil)
    }

    public var feature: String? { "drafts" }
    public var messages: Set<String> { ["draftList", "draftLoad", "draftSave", "draftClear"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        switch name {
        case "draftList":
            return .array(try folder.list().map { ["id": .string($0.id), "savedAt": Self.millis($0.savedAt)] })
        case "draftLoad":
            guard let d = try folder.load(try Self.string(body, "id")) else { return nil }
            return ["bytes": .string(d.bytes.base64EncodedString()), "savedAt": Self.millis(d.savedAt)]
        case "draftSave":
            let release = keepAlive()
            defer { release() }
            guard let bytes = Data(base64Encoded: try Self.string(body, "bytes")) else { throw DraftError.badBody }
            try folder.save(try Self.string(body, "id"), bytes)
            return nil
        default:
            try folder.clear(try Self.string(body, "id"))
            return nil
        }
    }

    static func string(_ body: JSONValue, _ key: String) throws -> String {
        guard case .object(let o) = body, case .string(let s)? = o[key] else { throw DraftError.badBody }
        return s
    }

    static func millis(_ date: Date) -> JSONValue {
        .number((date.timeIntervalSince1970 * 1000).rounded())
    }
}
