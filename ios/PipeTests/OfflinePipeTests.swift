// 離線存放存在殼裡（#383）：真的 WKWebView 走一次，看 App 裡存在哪、標成不備份。規則在 ShellCore 的 OfflinePartTests 和情境（swift test）。
import Foundation
import ShellCore
import Testing
@testable import CheerEditor

@MainActor
@Suite(.serialized)
struct OfflinePipeTests {
    @Test func App的離線存放在ApplicationSupport_不在tmp和Caches_不進備份() async throws {
        let h = Harness(siteRoot: fixtures, parts: { _ in [OfflinePart(folder: .inApplicationSupport())] })
        try await h.load("pipe.html")
        let id = "pipe-\(UUID().uuidString.prefix(8))"
        let out = try await h.js("""
            await window.__cheerShell.send('copySave', {flowId: id, value: {v: 1, flowId: id}});
            await window.__cheerShell.send('copyAudioSave', {flowId: id, audioId: 'a1', bytes: 'AQID'});
            return await window.__cheerShell.send('copyAudioLoad', {flowId: id, audioId: 'a1'});
            """, ["id": id])
        let root = OfflineFolder.inApplicationSupport().root
        defer { _ = try? FileManager.default.removeItem(at: root.appendingPathComponent("copies/\(id).json")) }
        defer { _ = try? FileManager.default.removeItem(at: root.appendingPathComponent("audio/\(id)")) }
        #expect(out as? String == "AQID")
        let path = root.resolvingSymlinksInPath().path
        #expect(path.hasSuffix("/Library/Application Support/Offline"), "\(path)")
        #expect(!path.contains("/tmp/") && !path.contains("/Caches/"), "\(path)")
        #expect(try root.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }
}
