// 殼自己從網站更新網頁（#393、ADR 0025）：用假網站，一條規則一個測試。
import CryptoKit
import Foundation
import Testing
import ShellCore

/// 假網站：路徑 → 內容。記下每次抓了哪個網址；可以設某個路徑抓到一半斷掉。
@MainActor
final class FakeSite {
    static let base = URL(string: "https://site.test")!
    var files: [String: Data] = [:]
    var breaks: Set<String> = []
    private(set) var asked: [URL] = []

    /// 放一包網頁（每個檔的內容），清單照 scripts/web-bundle.mjs 的算法算好。回傳整包的代號。
    @discardableResult
    func publish(_ bundle: [String: String], minShellBuild: Int? = nil) -> String {
        files = bundle.mapValues { Data($0.utf8) }
        let manifest = Self.manifest(bundle, minShellBuild: minShellBuild)
        files["web-bundle.json"] = Data(manifest.json.utf8)
        return manifest.id
    }

    static func manifest(_ bundle: [String: String], minShellBuild: Int? = nil) -> (id: String, json: String) {
        let sorted = bundle.keys.sorted()
        let entries = sorted.map { path -> JSONValue in
            let data = Data(bundle[path]!.utf8)
            return ["path": .string(path), "size": .number(Double(data.count)), "sha256": .string(sha(data))]
        }
        let id = sha(Data(sorted.map { "\(sha(Data(bundle[$0]!.utf8)))  \($0)\n" }.joined().utf8))
        var list: [String: JSONValue] = ["id": .string(id), "files": .array(entries)]
        if let minShellBuild { list["minShellBuild"] = .number(Double(minShellBuild)) }
        return (id, JSONValue.object(list).jsonString)
    }

    static func sha(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    func fetch(_ url: URL) async throws -> Data {
        asked.append(url)
        await Task.yield()  // 像真的網路一樣讓出去（同時檢查兩次的測試要）
        guard url.host == Self.base.host else { throw URLError(.badURL) }
        let path = String(url.path.dropFirst())
        if breaks.contains(path) { throw URLError(.networkConnectionLost) }
        // 網站找不到檔時回 200.html（狀態一樣是 200，server/src/lib.rs）
        return files[path] ?? Data("<!doctype html><title>200</title>".utf8)
    }
}

let bundledFiles = ["index.html": "附的那包", "_app/a.js": "a1"]
let newFiles = ["index.html": "新的那包", "_app/a.js": "a2"]
let otherFiles = ["index.html": "另一包", "_app/a.js": "a3"]

/// 一個殼：附的那包放在暫存資料夾，下載的放另一個。測試結束不清（暫存資料夾系統會清）。
@MainActor
final class Updater {
    let site = FakeSite()
    let bundled: URL
    let root: URL
    var rolledBack = 0
    private(set) var updater: WebUpdater!

    /// shellBuild：殼的建置號（比清單的 minShellBuild）。
    let shellBuild: Int

    init(trialTimeout: Duration = .seconds(10), shellBuild: Int = 1) throws {
        self.shellBuild = shellBuild
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("web-updater-\(UUID().uuidString)")
        bundled = tmp.appendingPathComponent("Web.bundle")
        root = tmp.appendingPathComponent("WebBundles")
        try FileManager.default.createDirectory(at: bundled, withIntermediateDirectories: true)
        for (path, text) in bundledFiles {
            let url = bundled.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url)
        }
        try Data(FakeSite.manifest(bundledFiles).json.utf8).write(to: bundled.appendingPathComponent("web-bundle.json"))
        restart(trialTimeout: trialTimeout)
    }

    /// 把 App 關掉再打開（存的東西還在）。
    func restart(trialTimeout: Duration = .seconds(10)) {
        updater = WebUpdater(site: FakeSite.base, root: root, bundled: bundled, shellBuild: shellBuild, fetch: { [site] in try await site.fetch($0) },
                             trialTimeout: trialTimeout, rolledBack: { [unowned self] in self.rolledBack += 1 })
        updater.launch()
    }

    /// 網頁現在開的那包的 index.html。
    var showing: String {
        let dir = updater.servingRoot ?? bundled
        return (try? String(contentsOf: dir.appendingPathComponent("index.html"), encoding: .utf8)) ?? "（沒有）"
    }
}

@MainActor
struct WebUpdaterTests {
    @Test func 跟網站上的一樣就不動() async throws {
        let u = try Updater()
        u.site.publish(bundledFiles)
        #expect(await u.updater.check() == .same)
        #expect(u.site.asked.map(\.path) == ["/web-bundle.json"])
        #expect(!u.updater.useNew())
        #expect(u.showing == "附的那包")
    }

    @Test func 不一樣就下載整包_每個檔都抓() async throws {
        let u = try Updater()
        let id = u.site.publish(newFiles)
        #expect(await u.updater.check() == .downloaded(id))
        #expect(Set(u.site.asked.map(\.path)) == ["/web-bundle.json", "/index.html", "/_app/a.js"])
    }

    @Test func 下載好了不馬上換_說換才換() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        #expect(u.showing == "附的那包")
        #expect(u.updater.useNew())
        #expect(u.showing == "新的那包")
    }

    @Test func 下載好了不馬上換_下次打開才換() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        #expect(u.showing == "附的那包")
        u.restart()
        #expect(u.showing == "新的那包")
    }

    @Test func 一個檔對不上_整包丟掉_下次再抓() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        u.site.files["_app/a.js"] = Data("舊的檔".utf8)  // 部署換手那一下：新清單、舊檔
        #expect(await u.updater.check() == .discarded)
        #expect(!u.updater.useNew())
        u.restart()
        #expect(u.showing == "附的那包")
        let id = u.site.publish(newFiles)
        #expect(await u.updater.check() == .downloaded(id))
    }

    @Test func 拿到200html_整包丟掉() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        u.site.files["_app/a.js"] = nil  // 網站找不到，回 200.html
        #expect(await u.updater.check() == .discarded)
        #expect(!u.updater.useNew())
    }

    @Test func 清單本身拿到200html_什麼都不做() async throws {
        let u = try Updater()
        u.site.files = [:]
        #expect(await u.updater.check() == .failed)
        #expect(u.site.asked.count == 1)
    }

    @Test func 下載到一半斷了_整包丟掉() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        u.site.breaks = ["index.html"]
        #expect(await u.updater.check() == .discarded)
        #expect(!u.updater.useNew())
        u.restart()
        #expect(u.showing == "附的那包")
    }

    @Test func 換上後10秒沒說好了_退回原本那包() async throws {
        let u = try Updater(trialTimeout: .milliseconds(50))
        u.site.publish(newFiles)
        _ = await u.updater.check()
        #expect(u.updater.useNew())
        try await Task.sleep(for: .milliseconds(300))
        #expect(u.showing == "附的那包")
        #expect(u.rolledBack == 1)
    }

    @Test func 換上後說了好了_就留著() async throws {
        let u = try Updater(trialTimeout: .milliseconds(50))
        u.site.publish(newFiles)
        _ = await u.updater.check()
        #expect(u.updater.useNew())
        u.updater.webSaidReady()
        try await Task.sleep(for: .milliseconds(300))
        #expect(u.showing == "新的那包")
        #expect(u.rolledBack == 0)
        u.restart()
        #expect(u.showing == "新的那包")
    }

    @Test func 換上後網頁當掉_退回原本那包() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        #expect(u.updater.useNew())
        #expect(u.updater.webCrashed())
        #expect(u.showing == "附的那包")
        #expect(u.rolledBack == 1)
    }

    @Test func 說了好了以後當掉_不退回() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        u.updater.webSaidReady()
        #expect(!u.updater.webCrashed())
        #expect(u.showing == "新的那包")
    }

    @Test func 退回到上一包好的_不是附的那包() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        u.updater.webSaidReady()
        u.site.publish(otherFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        #expect(u.showing == "另一包")
        _ = u.updater.webCrashed()
        #expect(u.showing == "新的那包")
    }

    @Test func 壞的那包不再抓_網站換了才再抓() async throws {
        let u = try Updater()
        let bad = u.site.publish(newFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        _ = u.updater.webCrashed()
        u.site.publish(newFiles)
        let before = u.site.asked.count
        #expect(await u.updater.check() == .bad(bad))
        #expect(u.site.asked.count == before + 1)  // 只抓清單
        u.restart()
        #expect(await u.updater.check() == .bad(bad))
        let other = u.site.publish(otherFiles)
        #expect(await u.updater.check() == .downloaded(other))
    }

    @Test func 換上後還沒說好了就被關掉_下次打開再等10秒() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        u.restart(trialTimeout: .milliseconds(50))
        #expect(u.showing == "新的那包")
        try await Task.sleep(for: .milliseconds(300))
        #expect(u.showing == "附的那包")
    }

    @Test func 比的是一不一樣_網站倒回附的那包也換回去_不用下載() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        u.updater.webSaidReady()
        let old = u.site.publish(bundledFiles)
        let before = u.site.asked.count
        #expect(await u.updater.check() == .downloaded(old))
        #expect(u.site.asked.count == before + 1)
        #expect(u.updater.useNew())
        #expect(u.showing == "附的那包")
    }

    @Test func 比的是一不一樣_網站倒回上一包也換回去() async throws {
        let u = try Updater()
        let first = u.site.publish(newFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        u.updater.webSaidReady()
        u.site.publish(otherFiles)
        _ = await u.updater.check()
        _ = u.updater.useNew()
        u.updater.webSaidReady()
        u.site.publish(newFiles)
        #expect(await u.updater.check() == .downloaded(first))
        _ = u.updater.useNew()
        #expect(u.showing == "新的那包")
    }

    @Test func 下載好了還沒換_網站又倒回現在這包_就不換了() async throws {
        let u = try Updater()
        u.site.publish(newFiles)
        _ = await u.updater.check()
        u.site.publish(bundledFiles)
        #expect(await u.updater.check() == .same)
        #expect(!u.updater.useNew())
    }

    @Test(arguments: [
        "https://evil.test/x.js", "//evil.test/x.js", "../x.js", "/x.js", "a/../../x.js", "a\\b.js", "a//b.js", "",
    ])
    func 別的網站的檔不抓_整包丟掉(_ path: String) async throws {
        let u = try Updater()
        let files = [["path": JSONValue.string(path), "size": 1, "sha256": .string(String(repeating: "0", count: 64))]]
        u.site.files = ["web-bundle.json": Data(JSONValue.object([
            "id": .string(String(repeating: "a", count: 64)), "files": .array(files.map(JSONValue.object)),
        ]).jsonString.utf8)]
        #expect(await u.updater.check() == .failed)
        #expect(u.site.asked.map(\.absoluteString) == ["https://site.test/web-bundle.json"])
    }

    @Test(arguments: ["../../x", "abc", String(repeating: "A", count: 64)])
    func 清單的代號不是64個16進位字_不收(_ id: String) async throws {
        let u = try Updater()
        u.site.files = ["web-bundle.json": Data(#"{"id":"\#(id)","files":[]}"#.utf8)]
        #expect(await u.updater.check() == .failed)
    }

    @Test func 清單只從自己的網站抓() async throws {
        let u = try Updater()
        u.site.publish(bundledFiles)
        _ = await u.updater.check()
        #expect(u.site.asked.allSatisfy { $0.scheme == "https" && $0.host == "site.test" })
    }

    @Test func 同時檢查兩次_只抓一次() async throws {
        let u = try Updater()
        let id = u.site.publish(newFiles)
        async let a = u.updater.check()
        async let b = u.updater.check()
        let results = await [a, b]
        #expect(results.filter { $0 == .busy }.count == 1)
        #expect(results.contains(.downloaded(id)))
    }

    @Test func 清單要比自己新的殼_太舊就不換_只抓清單() async throws {
        let u = try Updater(shellBuild: 3)
        let id = u.site.publish(newFiles, minShellBuild: 4)
        #expect(await u.updater.check() == .tooOld(id))
        #expect(u.site.asked.map(\.path) == ["/web-bundle.json"])
        #expect(!u.updater.useNew())
        u.restart()
        #expect(u.showing == "附的那包")
    }

    @Test(arguments: [3, 2, nil] as [Int?])
    func 清單要的殼不比自己新_照常換(_ min: Int?) async throws {
        let u = try Updater(shellBuild: 3)
        let id = u.site.publish(newFiles, minShellBuild: min)
        #expect(await u.updater.check() == .downloaded(id))
        #expect(u.updater.useNew())
        #expect(u.showing == "新的那包")
    }

    @Test func 下載好了還沒換_網站換成要新殼的那包_不換() async throws {
        let u = try Updater(shellBuild: 3)
        u.site.publish(newFiles)
        _ = await u.updater.check()
        let id = u.site.publish(otherFiles, minShellBuild: 4)
        #expect(await u.updater.check() == .tooOld(id))
        #expect(!u.updater.useNew())
    }

    @Test func 正在檢查時再問_等那次檢查的結果() async throws {
        let u = try Updater()
        let id = u.site.publish(newFiles)
        async let a = u.updater.check()
        async let b = u.updater.latest()
        let results = await [a, b]
        #expect(results == [.downloaded(id), .downloaded(id)])
    }

    @Test func 網站的檔名有空白中文_照樣抓得到() async throws {
        let u = try Updater()
        let id = u.site.publish(["index.html": "新", "字 型.woff2": "f"])
        #expect(await u.updater.check() == .downloaded(id))
        #expect(u.site.asked.contains { $0.path == "/字 型.woff2" })
    }
}

struct SiteFetcherTests {
    @Test func 只跟著轉到同一個網站() {
        let site = URL(string: "https://site.test")!
        #expect(SiteFetcher.follows(URL(string: "https://site.test/a")!, site: site))
        #expect(!SiteFetcher.follows(URL(string: "https://evil.test/a")!, site: site))
        #expect(!SiteFetcher.follows(URL(string: "http://site.test/a")!, site: site))
        #expect(!SiteFetcher.follows(URL(string: "https://site.test:444/a")!, site: site))
    }
}
