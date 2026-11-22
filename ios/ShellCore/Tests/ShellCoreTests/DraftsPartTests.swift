// 草稿存在殼裡（#377）。網頁和殼說的話在 bridge-scenarios/current/drafts.json（ScenarioTests 跑）；
// 這裡測情境測不到的：關掉再開還在、存的時間記在檔上、別的檔不算草稿。「真的在 Application Support、會備份」在 PipeTests 測（要 App 的沙盒）。
import Foundation
import Testing
import ShellCore

extension DraftFolder {
    /// 情境用：一個空的暫存資料夾，時鐘停在 2026-01-01（情境的 savedAt）。
    static func forScenario() -> DraftFolder {
        DraftFolder(root: emptyFolder(), now: { Date(timeIntervalSince1970: 1_767_225_600) })
    }
}

func emptyFolder() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("drafts-\(UUID().uuidString)")
}

@MainActor
struct DraftsPartTests {
    @Test func 殼關掉再開_草稿和存的時間都還在() async throws {
        let root = emptyFolder()
        let first = DraftsPart(folder: DraftFolder(root: root, now: { Date(timeIntervalSince1970: 1000) }))
        _ = try await first.handle(name: "draftSave", body: ["id": "f1-a", "bytes": "AQID"])

        let again = DraftsPart(folder: DraftFolder(root: root, now: { Date(timeIntervalSince1970: 5000) }))
        #expect(try await again.handle(name: "draftList", body: nil) == [["id": "f1-a", "savedAt": 1_000_000]])
        #expect(try await again.handle(name: "draftLoad", body: ["id": "f1-a"]) == ["bytes": "AQID", "savedAt": 1_000_000])
    }

    @Test func 草稿是資料夾裡的流程檔_別的檔不列() async throws {
        let folder = DraftFolder.forScenario()
        let part = DraftsPart(folder: folder)
        _ = try await part.handle(name: "draftSave", body: ["id": "n1", "bytes": "AQID"])
        #expect(try Data(contentsOf: folder.root.appendingPathComponent("n1.zip")) == Data([1, 2, 3]))
        try Data().write(to: folder.root.appendingPathComponent(".DS_Store"))
        try Data().write(to: folder.root.appendingPathComponent("bad name.zip"))
        #expect(try await part.handle(name: "draftList", body: nil) == [["id": "n1", "savedAt": 1_767_225_600_000]])
    }

    @Test func 存的時候要殼別被系統暫停_存完放手() async throws {
        var log: [String] = []
        let part = DraftsPart(folder: .forScenario(), keepAlive: {
            log.append("開始")
            return { log.append("放手") }
        })
        _ = try await part.handle(name: "draftSave", body: ["id": "n1", "bytes": "AQID"])
        #expect(log == ["開始", "放手"])
        _ = try? await part.handle(name: "draftSave", body: ["id": "../x", "bytes": "AQID"])
        #expect(log == ["開始", "放手", "開始", "放手"])
    }

    @Test func 不是base64的不存() async throws {
        let part = DraftsPart(folder: .forScenario())
        await #expect(throws: (any Error).self) { try await part.handle(name: "draftSave", body: ["id": "n1", "bytes": "不是"]) }
        #expect(try await part.handle(name: "draftList", body: nil) == [])
    }
}
