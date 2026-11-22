// 離線存放存在殼裡（#383）。網頁和殼說的話在 bridge-scenarios/current/offline.json（ScenarioTests 跑）；
// 這裡測情境測不到的：存在哪、進不進 iCloud 備份（離線副本、沒傳的紀錄、這台登入的是誰不進；草稿、小設定會進），關掉再開還在。
import Foundation
import Testing
import ShellCore

extension OfflineFolder {
    /// 情境用：暫存資料夾裡空的一份。
    static func forScenario() -> OfflineFolder {
        OfflineFolder(root: emptyFolder().appendingPathComponent("Offline", isDirectory: true))
    }
}

private func excluded(_ url: URL) throws -> Bool {
    try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true
}

private let copy: JSONValue = ["v": 1, "flowId": "c1", "name": "全國賽", "flow": ["name": "全國賽"]]
private let unsent: JSONValue = ["v": 1, "flowId": "c1", "flowName": "全國賽", "dropped": [["id": "t1"]]]
private let here: JSONValue = ["me": ["email": "lin@example.com", "name": "林教練", "isAdmin": false], "cloudIds": ["c1"]]

@MainActor
struct OfflinePartTests {
    @Test func 離線副本_沒傳的紀錄_這台登入的是誰都標成不備份_存了又存_清了再存還是() async throws {
        let folder = OfflineFolder.forScenario()
        let part = OfflinePart(folder: folder)
        for _ in 0..<2 {
            _ = try await part.handle(name: "copySave", body: ["flowId": "c1", "value": copy])
            _ = try await part.handle(name: "copyAudioSave", body: ["flowId": "c1", "audioId": "a1", "bytes": "AQID"])
            _ = try await part.handle(name: "unsentSave", body: ["flowId": "c1", "value": unsent])
            _ = try await part.handle(name: "signedInSave", body: ["value": here])
            #expect(try excluded(folder.root))
            // 四樣都存在這個不備份的資料夾底下（標在資料夾上：整個寫好才換上去的檔會換掉檔上的標記）
            let files = FileManager.default.enumerator(at: folder.root, includingPropertiesForKeys: [.isRegularFileKey])!
                .compactMap { $0 as? URL }.filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
            #expect(files.count == 4)
            _ = try await part.handle(name: "copiesClear", body: nil)
            _ = try await part.handle(name: "unsentClear", body: nil)
            #expect(try excluded(folder.root))
        }
    }

    @Test func App的離線存放在ApplicationSupport_Offline() {
        #expect(OfflineFolder.inApplicationSupport().root == URL.applicationSupportDirectory.appendingPathComponent("Offline", isDirectory: true))
    }

    @Test func 草稿和小設定沒有標成不備份() async throws {
        let drafts = DraftFolder(root: emptyFolder().appendingPathComponent("Drafts", isDirectory: true))
        _ = try await DraftsPart(folder: drafts).handle(name: "draftSave", body: ["id": "n1", "bytes": "AQID"])
        #expect(try !excluded(drafts.root))
        #expect(try !excluded(drafts.root.appendingPathComponent("n1.zip")))

        let settings = SettingsFile(url: emptyFolder().appendingPathComponent("settings.json"))
        _ = try await SettingsPart(file: settings).handle(name: "settingSet", body: ["key": "k", "value": "v"])
        #expect(try !excluded(settings.url))
        #expect(try !excluded(settings.url.deletingLastPathComponent()))
    }

    @Test func 殼關掉再開_離線副本和音樂還在() async throws {
        let root = emptyFolder().appendingPathComponent("Offline", isDirectory: true)
        let first = OfflinePart(folder: OfflineFolder(root: root))
        _ = try await first.handle(name: "copySave", body: ["flowId": "c1", "value": copy])
        _ = try await first.handle(name: "copyAudioSave", body: ["flowId": "c1", "audioId": "a1", "bytes": "AQID"])

        let again = OfflinePart(folder: OfflineFolder(root: root))
        #expect(try await again.handle(name: "copyList", body: nil) == [copy])
        #expect(try await again.handle(name: "copyAudioLoad", body: ["flowId": "c1", "audioId": "a1"]) == "AQID")
    }

    @Test func 只留給的那幾個音樂() async throws {
        let part = OfflinePart(folder: .forScenario())
        _ = try await part.handle(name: "copyAudioSave", body: ["flowId": "c1", "audioId": "a1", "bytes": "AQID"])
        _ = try await part.handle(name: "copyAudioSave", body: ["flowId": "c1", "audioId": "a2", "bytes": "BAU="])
        _ = try await part.handle(name: "copyAudioKeep", body: ["flowId": "c1", "ids": ["a2", "a3"]])
        #expect(try await part.handle(name: "copyAudioList", body: ["flowId": "c1"]) == ["a2"])
    }
}
