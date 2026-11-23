// 草稿存在殼裡（#377）：真的 WKWebView、真的那包網頁走一次。規則在 ShellCore 的 DraftsPartTests 和情境（swift test）。
import Foundation
import ShellCore
import Testing
import UIKit
import WebKit
@testable import CheerEditor

@MainActor
@Suite(.serialized)
struct DraftsPipeTests {
    func tempFolder() -> DraftFolder {
        DraftFolder(root: FileManager.default.temporaryDirectory.appendingPathComponent("drafts-\(UUID().uuidString)"))
    }

    func site() throws -> URL {
        try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
    }

    func files(_ folder: DraftFolder) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: folder.root.path)) ?? []).filter { $0.hasSuffix(".zip") }
    }

    /// 真的那包網頁、iPad 橫拿的大小（手機是檢視模式，不能新建），接 App 的草稿那一塊（資料夾換成暫存的）。
    /// 網頁的資料（IndexedDB）放自己的一份：別的管子測試同時開真的那包網頁、沒接殼的草稿，會在共用的那份開 cheer-editor。
    func editor(_ folder: DraftFolder, _ store: WKWebsiteDataStore = .nonPersistent()) async throws -> Harness {
        let h = Harness(siteRoot: try site(), parts: { [DraftsPart.inApp(outbox: $0.outbox, folder: folder)] },
                        size: CGSize(width: 1194, height: 834), dataStore: store)
        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        return h
    }

    /// 新建「管子測試」、加一段音樂段、放 3 秒的 wav、播放（new-flow-play.js），等草稿存進殼的資料夾。
    func newFlowWithMusic(_ h: Harness, _ folder: DraftFolder) async throws {
        let script = try String(contentsOf: fixtures.appendingPathComponent("new-flow-play.js"), encoding: .utf8)
        #expect(try await h.js(script) as? String == "新建了、放了音樂、在播")
        try await h.waitUntil("草稿存進殼的資料夾") { files(folder).count == 1 }
    }

    @Test func App的草稿在ApplicationSupport_不在tmp和Caches_會進備份() async throws {
        let h = Harness(siteRoot: fixtures, parts: { [DraftsPart.inApp(outbox: $0.outbox)] })
        try await h.load("pipe.html")
        let id = "pipe-\(UUID().uuidString.prefix(8))"
        _ = try await h.js("return await window.__cheerShell.send('draftSave', {id, bytes: 'AQID'})", ["id": id])
        let file = DraftFolder.inApplicationSupport().root.appendingPathComponent("\(id).zip")
        defer { try? FileManager.default.removeItem(at: file) }
        #expect(try Data(contentsOf: file) == Data([1, 2, 3]))
        let path = file.resolvingSymlinksInPath().path
        #expect(path.contains("/Library/Application Support/Drafts/"), "\(path)")
        #expect(!path.contains("/tmp/") && !path.contains("/Caches/"), "\(path)")
        #expect(try file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == false)
        #expect(try file.deletingLastPathComponent().resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == false)
    }

    /// 開工先驗（#360、#377）：整包流程檔（含音樂）傳給殼快不快。數字寫在 ios/README.md「草稿」。只在模擬器上量（Mac 的 CPU），真機在 #379。
    @Test func 量_60MB的草稿存一次讀一次多久() async throws {
        let folder = tempFolder()
        let h = Harness(siteRoot: fixtures, parts: { _ in [DraftsPart(folder: folder)] })
        try await h.load("pipe.html")
        let out = try await h.js("""
            const N = 60 * 1024 * 1024;
            const bytes = new Uint8Array(N);
            for (let i = 0; i < N; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
            const shell = window.__cheerShell;
            let t = performance.now();
            await shell.send('draftSave', { id: 'big', bytes: bytes.toBase64() });
            const save = performance.now() - t;
            t = performance.now();
            const back = Uint8Array.fromBase64((await shell.send('draftLoad', { id: 'big' })).bytes);
            const load = performance.now() - t;
            const same = back.length === N && back[N - 1] === bytes[N - 1] && back[777777] === bytes[777777];
            t = performance.now();
            for (let i = 0; i < 5; i++) Uint8Array.fromBase64((await shell.send('draftLoad', { id: 'big' })).bytes);
            return JSON.stringify({ save: Math.round(save), load: Math.round(load), load5: Math.round(performance.now() - t), same });
            """) as? String ?? ""
        print("草稿 60 MB｜\(out)")
        #expect(out.contains(#""same":true"#))
        #expect(try Data(contentsOf: folder.root.appendingPathComponent("big.zip")).count == 60 * 1024 * 1024)
    }

    @Test func 真的那包網頁_編一支本機流程_關掉再開_最近的流程有它_打開是最後的樣子() async throws {
        let folder = tempFolder()
        let store = WKWebsiteDataStore.nonPersistent()
        do {
            let h = try await editor(folder, store)
            try await newFlowWithMusic(h, folder)
            // 停手超過 1 秒才關（馬上關的在下一個測試）
            try await Task.sleep(for: .seconds(1.5))
            let dbs = try await h.js("return (await indexedDB.databases()).map((d) => d.name).join(',')") as? String ?? ""
            #expect(!dbs.split(separator: ",").contains("cheer-editor"), "草稿不是存在網頁的 IndexedDB：\(dbs)")
        }
        // 關掉再開：新的網頁畫面，同一個資料夾、同一份網頁資料
        let h = try await editor(folder, store)
        try await h.waitUntil("最近的流程有它") {
            (try? await h.js("return [...document.querySelectorAll('.recent-name')].map((e) => e.textContent).join(',')")) as? String == "管子測試"
        }
        _ = try await h.js("document.querySelector('.recent-open').click(); return null")
        // 最後的樣子：那支流程、時間軸上有加的那段音樂段，音樂也跟著回來（不是「音樂檔不見了」）
        let look = """
            return document.title.startsWith('管子測試') + ' ' + document.querySelectorAll('.seg.music').length
                + ' ' + document.querySelectorAll('.seg.music.missing').length
            """
        try await h.waitUntil("打開是最後的樣子") { (try? await h.js(look)) as? String == "true 1 0" }
        print("打開以後｜\((try? await h.js(look)) as? String ?? "")｜\((try? await h.js("return document.title + ' ' + [...document.querySelectorAll('.seg')].map((e) => e.className + ':' + e.title).join(' / ')")) as? String ?? "")")
    }

    @Test func 真的那包網頁_改一下馬上要切到背景_不等停手1秒就存進殼() async throws {
        let folder = tempFolder()
        let h = try await editor(folder)
        try await newFlowWithMusic(h, folder)
        // 放音樂那幾下的草稿等它存好（停手 1 秒），等一下檔變了才只會是這次改的
        try await Task.sleep(for: .seconds(1.5))
        let file = folder.root.appendingPathComponent(files(folder)[0])
        let before = try Data(contentsOf: file)

        // 改一下（在最後再加一段音樂段），馬上要切到背景（App 切換器）
        _ = try await h.js("""
            document.querySelector('[aria-label="在最後加一段"]').click();
            await new Promise((ok) => setTimeout(ok, 50));
            [...document.querySelectorAll('[role=menuitem]')].find((el) => el.textContent.includes('音樂段')).click();
            return null
            """)
        let edited = Date()
        NotificationCenter.default.post(name: UIScene.willDeactivateNotification, object: nil)
        try await h.waitUntil("改的存進殼", seconds: 0.8) { (try? Data(contentsOf: file)) != before }
        let took = Date().timeIntervalSince(edited)
        print("要切到背景到存好｜\(Int(took * 1000)) ms")
        #expect(took < 0.8)
    }
}
