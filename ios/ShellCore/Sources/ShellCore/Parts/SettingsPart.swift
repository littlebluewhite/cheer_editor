// 小設定存在殼裡（#378，規格 #360「資料存在哪、網頁怎麼拿到」）：「我」、印誰、停下回起播點、圖例、分隔線大小，
// 加上「上次那支」（網頁記、網頁開，殼只存）。網頁建編輯器時就同步讀，所以殼在 document start 塞一份（boot 的 settings）；
// 網頁改了馬上 settingSet、settingRemove 寫回來（src/lib/shell-settings.ts）。說的話在 bridge-scenarios/current/settings.json。
// 存成一個 JSON 檔（key 裡有流程名字，不拿來當檔名）。App 裡是 Application Support/settings.json（不標成不備份，會進 iCloud 備份）。
import Foundation

@MainActor
public final class SettingsFile {
    public let url: URL
    private(set) var values: [String: String]

    /// 讀存著的那份；沒有、讀不懂就從空的開始。
    public init(url: URL) {
        self.url = url
        values = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))) ?? [:]
    }

    /// App 的小設定檔：Application Support/settings.json（系統不會清；會進 iCloud 備份）。
    public static func inApplicationSupport() -> SettingsFile {
        SettingsFile(url: URL.applicationSupportDirectory.appendingPathComponent("settings.json"))
    }

    func set(_ key: String, _ value: String?) throws {
        var next = values
        next[key] = value
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // 整個寫好才換上去：寫到一半被系統關掉，舊的那份還在
        try JSONEncoder().encode(next).write(to: url, options: .atomic)
        values = next
    }
}

enum SettingsError: Error { case badBody }

public struct SettingsPart: BridgePart {
    let file: SettingsFile

    public init(file: SettingsFile) {
        self.file = file
    }

    public var feature: String? { "settings" }
    public var messages: Set<String> { ["settingSet", "settingRemove"] }
    /// 每次都照現在存著的（網頁重新載入時再塞一次，要是最新的；WebShell 換頁前重建）。
    public var boot: [String: JSONValue] { ["settings": .object(file.values.mapValues(JSONValue.string))] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        guard case .object(let o) = body, case .string(let key)? = o["key"] else { throw SettingsError.badBody }
        if name == "settingRemove" {
            try file.set(key, nil)
        } else {
            guard case .string(let value)? = o["value"] else { throw SettingsError.badBody }
            try file.set(key, value)
        }
        return nil
    }
}
