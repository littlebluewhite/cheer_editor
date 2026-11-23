// 存檔蓋回原本的檔、「傳給別人」（#385）：真的 WKWebView、真的那包網頁、真的書籤和 NSFileCoordinator（FilePlaces.inPlace）走一次。
// 規則在 ShellCore 的 SaveFilePartTests 和情境（swift test）。系統的存檔畫面、分享選單測試按不到：問存到哪換成直接存到暫存資料夾，分享選單換成記下送了什麼。
import Foundation
import ShellCore
import Testing
import UIKit
@testable import CheerEditor

/// 一支叫「全國賽」的空流程（bridge-scenarios/current/openFile.json 的 bytes）。
private let contestFile = Data(base64Encoded: "UEsDBBQAAAAIAMY4eF3dPRWf2AAAACYBAAAJAAAAZmxvdy5qc29uNY89TgMxEIXv8moXWZAQuKWioAmIBqUwzixY8k9kj/nRyiUVV+AA6VPnOJFyjMzuJp393ps33wzoUw6GXygXlyJ0d6PQ+/QFPSCaQNA4/G4P/3/H3R5iOfLr0Suc3aZA3yl485MqS/CTMjtrPJoCu0DL6kkiA8ZizpUUgov3HybyE1no64UI5vuxFmcnobualefExs/K7ULKAoU3AYR+XSmYunZpfhZ6DxT5bMyXyBXjf4ATTvSdQJ9jDyLE6r1UCK1s2qSRrjWZtbVwCss0AU9b7KVp1doJUEsBAhQAFAAAAAgAxjh4Xd09FZ/YAAAAJgEAAAkAAAAAAAAAAAAAAAAAAAAAAGZsb3cuanNvblBLBQYAAAAAAQABADcAAAD/AAAAAAA=")!

@MainActor
@Suite(.serialized, .timeLimit(.minutes(1)))
struct SaveFilePipeTests {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("save-file-\(UUID().uuidString)")

    /// 資料夾裡的「全國賽.cheer」。
    func handed() throws -> URL {
        let url = folder.appendingPathComponent("files/全國賽.cheer")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try contestFile.write(to: url)
        return url
    }

    /// 真的那包網頁、iPad 橫拿的大小，接草稿、小設定、開流程檔、存流程檔四塊。askWhere 存到 files/，記下問了幾次；分享選單記下送的檔名。
    func app() throws -> (Harness, OpenFilePart, Record) {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let record = Record()
        let files = folder.appendingPathComponent("files")
        var open: OpenFilePart!
        let h = Harness(siteRoot: site, parts: {
            open = OpenFilePart(outbox: $0.outbox)
            let save = SaveFilePart(
                askWhere: { name, bytes in
                    record.asked.append(name)
                    let url = files.appendingPathComponent(name)
                    try? bytes.write(to: url)
                    return url
                },
                share: { name, bytes, _ in
                    record.shared.append((name, bytes))
                    return true
                })
            return [DraftsPart.inApp(outbox: $0.outbox, folder: DraftFolder(root: folder.appendingPathComponent("drafts"))),
                    SettingsPart(file: SettingsFile(url: folder.appendingPathComponent("settings.json"))), open, save]
        }, size: CGSize(width: 1194, height: 834))
        return (h, open, record)
    }

    @MainActor final class Record {
        var asked: [String] = []
        var shared: [(String, Data)] = []
    }

    func showing(_ h: Harness, flow name: String) async -> Bool {
        let look = "return getComputedStyle(document.body).visibility !== 'hidden' && document.title.startsWith(name) && !!document.querySelector('.field-host')"
        return (try? await h.js(look, ["name": name])) as? Bool == true
    }

    func pressSave(_ h: Harness) async throws {
        _ = try await h.js("document.querySelector('button.save.primary').click()")
    }

    @Test func 真的那包網頁_從檔案打開_按存檔_蓋回原本那個檔_沒有多出新檔() async throws {
        let (h, open, record) = try app()
        let url = try handed()
        open.handOver(url, inPlace: true)
        try await h.load("")
        try await h.waitUntil("打開交來的那支") { await showing(h, flow: "全國賽") }
        try await pressSave(h)
        // 存檔寫的 zip 帶存的時間，跟原本的位元組不一樣
        try await h.waitUntil("原本那個檔換成存的") { (try? Data(contentsOf: url)) != contestFile }
        #expect(record.asked.isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: url.deletingLastPathComponent().path) == ["全國賽.cheer"])
    }

    @Test func 真的那包網頁_分享選單交來的副本_第一次問存到哪_第二次蓋回去不問() async throws {
        let (h, open, record) = try app()
        let copy = try handed()
        open.handOver(copy, inPlace: false)
        try await h.load("")
        try await h.waitUntil("打開交來的那支") { await showing(h, flow: "全國賽") }
        try await pressSave(h)
        try await h.waitUntil("問存到哪") { record.asked == ["全國賽.cheer"] }
        let saved = try Data(contentsOf: copy)
        // zip 裡的時間兩秒一格：隔一格再存，位元組才不一樣
        try await Task.sleep(for: .milliseconds(2100))
        try await pressSave(h)
        try await h.waitUntil("第二次蓋回去") { (try? Data(contentsOf: copy)) != saved }
        #expect(record.asked == ["全國賽.cheer"])
    }

    @Test func 真的那包網頁_選單按傳給別人_分享選單送流程名zip() async throws {
        let (h, open, record) = try app()
        open.handOver(try handed(), inPlace: true)
        try await h.load("")
        try await h.waitUntil("打開交來的那支") { await showing(h, flow: "全國賽") }
        _ = try await h.js("document.querySelector('button.menu').click()")
        try await h.waitUntil("選單有傳給別人") {
            (try? await h.js("return [...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent.includes('傳給別人'))")) as? Bool == true
        }
        _ = try await h.js("[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.includes('傳給別人')).click()")
        try await h.waitUntil("送出去") { record.shared.count == 1 }
        #expect(record.shared.first?.0 == "全國賽.zip")
        // 送的是流程檔（zip 開頭 PK）
        #expect(record.shared.first?.1.prefix(2) == Data("PK".utf8))
    }
}
