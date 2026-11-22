// 離線存放存在殼裡（#383，規格 #360「資料存在哪、網頁怎麼拿到」）：網頁的離線存放（src/lib/shell-offline.ts）問殼。
// 存三樣：雲端流程還沒傳的紀錄、離線副本（含音樂）、這台登入的是誰。存的樣子由網頁決定（帶版號），殼原樣存、原樣回。
// App 裡的資料夾是 Application Support/Offline，整個資料夾標成不進 iCloud 備份：還原時可能把舊的改動再送一次；離線副本很大、能再下載。
// 標在資料夾上（不標在檔上）：整個寫好才換上去（.atomic）的檔是新的檔，檔上的標記會不見。
//   unsent/<流程 id>.json、copies/<流程 id>.json、audio/<流程 id>/<音樂 id>、signedIn.json
// 留幾支、登出清什麼照網頁版（src/lib/flow-file.svelte.ts、home.svelte.ts），殼只存、讀、列、刪。說的話在 bridge-scenarios/current/offline.json。
import Foundation

public struct OfflineFolder: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// App 的離線存放：Application Support/Offline（系統不會清；不進 iCloud 備份）。
    public static func inApplicationSupport() -> OfflineFolder {
        OfflineFolder(root: URL.applicationSupportDirectory.appendingPathComponent("Offline", isDirectory: true))
    }

    /// 流程 id、音樂 id 當檔名用：只收英數字、-、_。
    static func isId(_ id: String) -> Bool { PartFiles.isSafeName(id) }

    func dir(_ name: String) -> URL { root.appendingPathComponent(name, isDirectory: true) }

    func file(_ kind: String, _ id: String) throws -> URL {
        guard Self.isId(id) else { throw OfflineError.badId }
        return dir(kind).appendingPathComponent("\(id).json")
    }

    func audioDir(_ flowId: String) throws -> URL {
        guard Self.isId(flowId) else { throw OfflineError.badId }
        return dir("audio").appendingPathComponent(flowId, isDirectory: true)
    }

    var signedInFile: URL { root.appendingPathComponent("signedIn.json") }

    /// 建資料夾、每次都再標一次不備份（資料夾被刪掉重建也照樣標著）。
    func make(_ folder: URL) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var root = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try root.setResourceValues(values)
    }

    func write(_ data: Data, to url: URL) throws {
        try make(url.deletingLastPathComponent())
        try data.write(to: url, options: .atomic)
    }

    func remove(_ url: URL) throws { try PartFiles.remove(url) }

    func names(in folder: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted()
    }

    /// 一個資料夾裡每個 <id>.json 讀出來（照 id 排；讀不懂的跳過）。
    func values(_ kind: String) -> [JSONValue] {
        names(in: dir(kind)).compactMap { name in
            guard name.hasSuffix(".json"), Self.isId(String(name.dropLast(5))) else { return nil }
            return try? JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: dir(kind).appendingPathComponent(name)))
        }
    }
}

enum OfflineError: Error { case badId, badBody }

public struct OfflinePart: BridgePart {
    let folder: OfflineFolder

    public init(folder: OfflineFolder) {
        self.folder = folder
    }

    public var feature: String? { "offline" }
    public var messages: Set<String> {
        ["unsentList", "unsentSave", "unsentDrop", "unsentClear",
         "copyList", "copySave", "copyDrop", "copiesClear",
         "copyAudioList", "copyAudioLoad", "copyAudioSave", "copyAudioKeep",
         "signedInLoad", "signedInSave"]
    }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        let f = folder
        switch name {
        case "unsentList": return .array(f.values("unsent"))
        case "unsentSave": try f.write(try JSONEncoder().encode(try Self.value(body)), to: try f.file("unsent", try Self.string(body, "flowId")))
        case "unsentDrop": try f.remove(try f.file("unsent", try Self.string(body, "flowId")))
        case "unsentClear": try f.remove(f.dir("unsent"))
        case "copyList": return .array(f.values("copies"))
        case "copySave": try f.write(try JSONEncoder().encode(try Self.value(body)), to: try f.file("copies", try Self.string(body, "flowId")))
        case "copyDrop":
            let flowId = try Self.string(body, "flowId")
            try f.remove(try f.file("copies", flowId))
            try f.remove(try f.audioDir(flowId))
        case "copiesClear":
            for url in [f.dir("copies"), f.dir("audio"), f.signedInFile] { try f.remove(url) }
        case "copyAudioList":
            return .array(f.names(in: try f.audioDir(try Self.string(body, "flowId"))).filter(OfflineFolder.isId).map(JSONValue.string))
        case "copyAudioLoad":
            let url = try Self.audioFile(f, body)
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            return .string(try Data(contentsOf: url).base64EncodedString())
        case "copyAudioSave":
            let url = try Self.audioFile(f, body)
            guard let bytes = Data(base64Encoded: try Self.string(body, "bytes")) else { throw OfflineError.badBody }
            try f.write(bytes, to: url)
        case "copyAudioKeep":
            let dir = try f.audioDir(try Self.string(body, "flowId"))
            guard case .object(let o) = body, case .array(let ids)? = o["ids"] else { throw OfflineError.badBody }
            let keep = Set(ids.compactMap { if case .string(let s) = $0 { s } else { nil } })
            for name in f.names(in: dir) where !keep.contains(name) { try f.remove(dir.appendingPathComponent(name)) }
        case "signedInLoad":
            guard let data = try? Data(contentsOf: f.signedInFile) else { return nil }
            return (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? nil
        default:
            try f.write(try JSONEncoder().encode(try Self.value(body)), to: f.signedInFile)
        }
        return nil
    }

    static func audioFile(_ f: OfflineFolder, _ body: JSONValue) throws -> URL {
        let audioId = try string(body, "audioId")
        guard OfflineFolder.isId(audioId) else { throw OfflineError.badId }
        return try f.audioDir(try string(body, "flowId")).appendingPathComponent(audioId)
    }

    static func string(_ body: JSONValue, _ key: String) throws -> String {
        try PartFiles.string(body, key, or: OfflineError.badBody)
    }

    static func value(_ body: JSONValue) throws -> JSONValue {
        guard case .object(let o) = body, let v = o["value"], v != .null else { throw OfflineError.badBody }
        return v
    }
}
