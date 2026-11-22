// 小設定存在殼裡、打開 App 就回上次那支（#378）：真的 WKWebView、真的那包網頁走一次。規則在 ShellCore 的 SettingsPartTests 和情境（swift test）。
import Foundation
import ShellCore
import Testing
import UIKit
@testable import CheerEditor

@MainActor
@Suite(.serialized)
struct SettingsPipeTests {
    func tempSettings() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("settings-\(UUID().uuidString)/settings.json")
    }

    func tempDrafts() -> DraftFolder {
        DraftFolder(root: FileManager.default.temporaryDirectory.appendingPathComponent("drafts-\(UUID().uuidString)"))
    }

    func site() throws -> URL {
        try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
    }

    /// 真的那包網頁、iPad 橫拿的大小，接 App 的草稿、小設定那兩塊（檔換成暫存的）。像打開一次 App：每次都是新的網頁畫面。
    func app(_ drafts: DraftFolder, _ settings: URL) throws -> Harness {
        Harness(siteRoot: try site(),
                parts: { [DraftsPart.inApp(outbox: $0.outbox, folder: drafts), SettingsPart(file: SettingsFile(url: settings))] },
                size: CGSize(width: 1194, height: 834))
    }

    func saved(_ settings: URL) -> [String: String] {
        (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: settings))) ?? [:]
    }

    @Test func 網頁一開始就讀得到存著的小設定_改了寫回殼_重新載入塞的是新的() async throws {
        let settings = tempSettings()
        let h = Harness(siteRoot: fixtures, parts: { _ in [SettingsPart(file: SettingsFile(url: settings))] })
        try await h.load("pipe.html")
        #expect(try await h.js("return JSON.stringify(window.__cheerShell.boot.settings)") as? String == "{}")
        _ = try await h.js("return await window.__cheerShell.send('settingSet', {key: 'cheer-editor:legendOpen', value: '0'})")
        #expect(saved(settings) == ["cheer-editor:legendOpen": "0"])
        // 同一個網頁畫面重新載入（殼換上新網頁也是這樣）：塞的要是改過的，不是 App 打開時的
        try await h.load("pipe.html?again")
        #expect(try await h.js("return JSON.stringify(window.__cheerShell.boot.settings)") as? String == #"{"cheer-editor:legendOpen":"0"}"#)
    }

    @Test func App的小設定在ApplicationSupport_不在tmp和Caches_會進備份() throws {
        let url = SettingsFile.inApplicationSupport().url.resolvingSymlinksInPath()
        #expect(url.path.hasSuffix("/Library/Application Support/settings.json"), "\(url.path)")
        #expect(!url.path.contains("/tmp/") && !url.path.contains("/Caches/"))
        let folder = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        #expect(try folder.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == false)
    }

    @Test func 真的那包網頁_在流程裡關掉再開_直接進那支流程_中間不停在首頁() async throws {
        let drafts = tempDrafts(), settings = tempSettings()
        do {
            let h = try app(drafts, settings)
            try await h.load("")
            let script = try String(contentsOf: fixtures.appendingPathComponent("new-flow-play.js"), encoding: .utf8)
            #expect(try await h.js(script) as? String == "新建了、放了音樂、在播")
            // 離開 App（滑到 App 切換器）：網頁記下上次那支
            NotificationCenter.default.post(name: UIScene.willDeactivateNotification, object: nil)
            try await h.waitUntil("記下上次那支") { saved(settings)["cheer-editor:lastFlow"] != nil }
            let id = try #require(saved(settings)["cheer-editor:lastFlow"])
            try await h.waitUntil("那支的草稿存好") { FileManager.default.fileExists(atPath: drafts.root.appendingPathComponent("\(id).zip").path) }
        }
        // 關掉再開：新的網頁畫面，同樣的資料夾、小設定
        let h = try app(drafts, settings)
        let start = Date()
        h.shell.webView.load(URLRequest(url: BundledSite.home))
        var sawHome = false
        let look = """
            const shown = getComputedStyle(document.body).visibility !== 'hidden';
            return (shown && !!document.querySelector('form.new-flow')) + ' ' + (shown && document.title.startsWith('管子測試') && !!document.querySelector('.field-host'))
            """
        try await h.waitUntil("看到那支流程的場地") {
            let r = (try? await h.js(look)) as? String ?? ""
            if r.hasPrefix("true") { sawHome = true }
            return r.hasSuffix(" true")
        }
        let took = Date().timeIntervalSince(start)
        print("打開到看到上次那支的場地｜\(Int(took * 1000)) ms（模擬器，只當參考）")
        #expect(!sawHome, "中間畫了首頁")
    }

    @Test func 真的那包網頁_在首頁關掉再開_停在首頁() async throws {
        let drafts = tempDrafts(), settings = tempSettings()
        try FileManager.default.createDirectory(at: settings.deletingLastPathComponent(), withIntermediateDirectories: true)
        // 上次那支記的是一份不見了的草稿：一樣停在首頁，不卡住
        try Data(#"{"cheer-editor:lastFlow": "n-gone"}"#.utf8).write(to: settings)
        let h = try app(drafts, settings)
        try await h.load("")
        try await h.waitUntil("停在首頁、看得到") {
            (try? await h.js("return getComputedStyle(document.body).visibility !== 'hidden' && !!document.querySelector('form.new-flow')")) as? Bool == true
        }
        NotificationCenter.default.post(name: UIScene.willDeactivateNotification, object: nil)
        try await h.waitUntil("上次那支清掉") { saved(settings)["cheer-editor:lastFlow"] == nil }
    }
}
