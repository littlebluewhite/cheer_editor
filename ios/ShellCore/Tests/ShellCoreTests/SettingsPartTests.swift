// 小設定存在殼裡（#378）。網頁和殼說的話在 bridge-scenarios/current/settings.json（ScenarioTests 跑）；
// 這裡測情境測不到的：關掉再開還在、改了以後再塞的是新的、key 裡有怪字也存得住。「網頁重新載入時塞的是最新的」在 PipeTests 測。
import Foundation
import Testing
import ShellCore

extension SettingsFile {
    /// 情境用：暫存資料夾裡的一份，存著 returnOnStop 0、上次那支 f3-abc（settings.json 的每個情境一開始塞的）。
    static func forScenario() -> SettingsFile {
        let url = emptyFolder().appendingPathComponent("settings.json")
        try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try! Data(#"{"cheer-editor:returnOnStop": "0", "cheer-editor:lastFlow": "f3-abc"}"#.utf8).write(to: url)
        return SettingsFile(url: url)
    }
}

@MainActor
struct SettingsPartTests {
    @Test func 殼關掉再開_小設定還在() async throws {
        let url = emptyFolder().appendingPathComponent("settings.json")
        let first = SettingsPart(file: SettingsFile(url: url))
        #expect(first.boot == ["settings": [:]])
        _ = try await first.handle(name: "settingSet", body: ["key": "cheer-editor:me:全國賽/決賽 ../a", "value": "m1"])
        _ = try await first.handle(name: "settingSet", body: ["key": "cheer-editor:legendOpen", "value": "0"])
        _ = try await first.handle(name: "settingRemove", body: ["key": "cheer-editor:legendOpen"])

        let again = SettingsPart(file: SettingsFile(url: url))
        #expect(again.boot == ["settings": ["cheer-editor:me:全國賽/決賽 ../a": "m1"]])
    }

    @Test func 改了以後一開始塞的就是新的() async throws {
        let part = SettingsPart(file: .forScenario())
        _ = try await part.handle(name: "settingSet", body: ["key": "cheer-editor:lastFlow", "value": "n2"])
        #expect(part.boot == ["settings": ["cheer-editor:returnOnStop": "0", "cheer-editor:lastFlow": "n2"]])
    }

    @Test func 存的檔讀不懂_從空的開始() throws {
        let url = emptyFolder().appendingPathComponent("settings.json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("不是 JSON".utf8).write(to: url)
        #expect(SettingsPart(file: SettingsFile(url: url)).boot == ["settings": [:]])
    }
}
