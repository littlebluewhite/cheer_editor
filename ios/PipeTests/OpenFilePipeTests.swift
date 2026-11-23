// 在 App 裡打開流程檔（#384）：真的 WKWebView、真的那包網頁走一次。規則在 ShellCore 的 OpenFilePartTests 和情境（swift test）。
// SceneDelegate 收到網址後叫的就是 handOver；「檔案」App 點一下、分享選單那幾下測試按不到，手動試（ios/README.md「打開流程檔」）。
import Foundation
import ShellCore
import Testing
import UIKit
@testable import CheerEditor

/// 一支叫「全國賽」的空流程（bridge-scenarios/current/openFile.json 的 bytes）。
private let contestFile = Data(base64Encoded: "UEsDBBQAAAAIAMY4eF3dPRWf2AAAACYBAAAJAAAAZmxvdy5qc29uNY89TgMxEIXv8moXWZAQuKWioAmIBqUwzixY8k9kj/nRyiUVV+AA6VPnOJFyjMzuJp393ps33wzoUw6GXygXlyJ0d6PQ+/QFPSCaQNA4/G4P/3/H3R5iOfLr0Suc3aZA3yl485MqS/CTMjtrPJoCu0DL6kkiA8ZizpUUgov3HybyE1no64UI5vuxFmcnobualefExs/K7ULKAoU3AYR+XSmYunZpfhZ6DxT5bMyXyBXjf4ATTvSdQJ9jDyLE6r1UCK1s2qSRrjWZtbVwCss0AU9b7KVp1doJUEsBAhQAFAAAAAgAxjh4Xd09FZ/YAAAAJgEAAAkAAAAAAAAAAAAAAAAAAAAAAGZsb3cuanNvblBLBQYAAAAAAQABADcAAAD/AAAAAAA=")!

@MainActor
@Suite(.serialized, .timeLimit(.minutes(1)))
struct OpenFilePipeTests {
    func temp(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("open-file-\(UUID().uuidString)").appendingPathComponent(name)
    }

    /// 交給 App 的檔：暫存資料夾裡的「全國賽.cheer」。
    func handed() throws -> URL {
        let url = temp("全國賽.cheer")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try contestFile.write(to: url)
        return url
    }

    /// 真的那包網頁、iPad 橫拿的大小，接草稿、小設定、開流程檔三塊（檔換成暫存的）。
    /// pick：選檔畫面選到的（換掉真的選檔畫面）。
    func app(drafts: DraftFolder, settings: URL, pick: @escaping @MainActor () async -> URL? = { nil }) throws -> (Harness, OpenFilePart) {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        var part: OpenFilePart!
        let h = Harness(siteRoot: site, parts: {
            part = OpenFilePart(outbox: $0.outbox, pick: pick)
            return [DraftsPart.inApp(outbox: $0.outbox, folder: drafts), SettingsPart(file: SettingsFile(url: settings)), part]
        }, size: CGSize(width: 1194, height: 834))
        return (h, part)
    }

    func showing(_ h: Harness, flow name: String) async -> Bool {
        let look = "return getComputedStyle(document.body).visibility !== 'hidden' && document.title.startsWith(name) && !!document.querySelector('.field-host')"
        return (try? await h.js(look, ["name": name])) as? Bool == true
    }

    @Test func 真的那包網頁_點流程檔打開App_開那個檔_不開上次那支() async throws {
        let drafts = DraftFolder(root: temp("drafts"))
        let settings = temp("settings.json")
        // 上次那支是另一支流程（管子測試的練習流程）
        let practice = try Data(contentsOf: fixtures.appendingPathComponent("practice-flow.zip"))
        _ = try await DraftsPart(folder: drafts).handle(name: "draftSave", body: ["id": "n1", "bytes": .string(practice.base64EncodedString())])
        try FileManager.default.createDirectory(at: settings.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"cheer-editor:lastFlow": "n1"}"#.utf8).write(to: settings)

        let (h, part) = try app(drafts: drafts, settings: settings)
        // App 還沒開著：網頁起來之前就交了（SceneDelegate 的 willConnectTo）
        part.handOver(try handed())
        try await h.load("")
        try await h.waitUntil("打開交來的那支") { await showing(h, flow: "全國賽") }
        // 上次那支的草稿還在
        #expect(FileManager.default.fileExists(atPath: drafts.root.appendingPathComponent("n1.zip").path))
    }

    @Test func 真的那包網頁_App開著時交來一個檔_打開它() async throws {
        let (h, part) = try app(drafts: DraftFolder(root: temp("drafts")), settings: temp("settings.json"))
        try await h.load("")
        try await h.waitUntil("停在首頁") {
            (try? await h.js("return getComputedStyle(document.body).visibility !== 'hidden' && !!document.querySelector('form.new-flow')")) as? Bool == true
        }
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        part.handOver(try handed())
        try await h.waitUntil("打開交來的那支") { await showing(h, flow: "全國賽") }
    }

    @Test func 真的那包網頁_首頁按開啟流程檔_請殼叫出選檔畫面_選了就打開() async throws {
        let picked = try handed()
        var asked = 0
        let (h, _) = try app(drafts: DraftFolder(root: temp("drafts")), settings: temp("settings.json"), pick: {
            asked += 1
            return picked
        })
        try await h.load("")
        try await h.waitUntil("停在首頁") {
            (try? await h.js("return getComputedStyle(document.body).visibility !== 'hidden' && !!document.querySelector('label.open input[type=file]')")) as? Bool == true
        }
        // 網頁程式接手前點，按鈕還沒接上（畫面是先畫好的）
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        _ = try await h.js("document.querySelector('label.open input[type=file]').click()")
        try await h.waitUntil("打開選的那支") { await showing(h, flow: "全國賽") }
        #expect(asked == 1)
    }
}
