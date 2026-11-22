// 雲端流程被擋時的「更新」按鈕、問殼太不太舊（#394）：橋上 WebUpdatePart 這一塊，用假網站（WebUpdaterTests 的 Updater）。
import Foundation
import Testing
import ShellCore

/// 一個殼的「殼自己更新網頁」這一塊；記下每次重新載入到哪個網址。
@MainActor
final class UpdateButton {
    @MainActor final class Sink { var urls: [URL] = [] }
    let u: Updater
    let part: WebUpdatePart
    private let sink = Sink()
    var reloads: [URL] { sink.urls }

    init(shellBuild: Int = 1) throws {
        u = try Updater(shellBuild: shellBuild)
        let sink = self.sink
        part = WebUpdatePart(updater: u.updater, outbox: ShellOutbox(), reload: { sink.urls.append($0) })
    }
}

@MainActor
struct WebUpdatePartTests {
    @Test func 按更新馬上換_還沒下載也先抓_回到同一支流程() async throws {
        let b = try UpdateButton()
        b.u.site.publish(newFiles)
        #expect(try await b.part.handle(name: "updateWebBundle", body: ["flow": "c1"]) == "updated")
        #expect(b.u.showing == "新的那包")
        #expect(b.reloads == [URL(string: "app://local/?cloud=c1")!])
    }

    @Test func 按更新時殼太舊_不換不重新載入() async throws {
        let b = try UpdateButton(shellBuild: 1)
        b.u.site.publish(newFiles, minShellBuild: 2)
        #expect(try await b.part.handle(name: "updateWebBundle", body: ["flow": "c1"]) == "tooOld")
        #expect(b.u.showing == "附的那包")
        #expect(b.reloads.isEmpty)
    }

    @Test func 按更新時抓不到新網頁_不換() async throws {
        let b = try UpdateButton()
        b.u.site.publish(bundledFiles)
        #expect(try await b.part.handle(name: "updateWebBundle", body: ["flow": "c1"]) == "none")
        #expect(b.reloads.isEmpty)
    }

    @Test func 流程代號只當網址的一個參數() async throws {
        let b = try UpdateButton()
        b.u.site.publish(newFiles)
        _ = try await b.part.handle(name: "updateWebBundle", body: ["flow": "a/../b?x=1&y#z"])
        let back = URLComponents(url: b.reloads[0], resolvingAgainstBaseURL: false)!
        #expect(back.host == "local")
        #expect(back.path == "/")
        #expect(back.fragment == nil)
        #expect(back.queryItems == [URLQueryItem(name: "cloud", value: "a/../b?x=1&y#z")])
    }

    @Test func 沒說哪支流程_回到首頁() async throws {
        let b = try UpdateButton()
        b.u.site.publish(newFiles)
        #expect(try await b.part.handle(name: "updateWebBundle", body: .null) == "updated")
        #expect(b.reloads == [URL(string: "app://local/")!])
    }

    @Test(arguments: ["ready", "tooOld", "none"])
    func 被擋時問殼_新網頁好了沒_殼太不太舊(_ want: String) async throws {
        let b = try UpdateButton(shellBuild: 1)
        switch want {
        case "ready": b.u.site.publish(newFiles)
        case "tooOld": b.u.site.publish(newFiles, minShellBuild: 2)
        default: b.u.site.publish(bundledFiles)
        }
        #expect(try await b.part.handle(name: "checkWebBundle", body: .null) == .string(want))
        #expect(b.u.showing == "附的那包", "問的時候不換")
        #expect(b.reloads.isEmpty)
    }

    @Test func 回到首頁的換照舊_回到首頁() async throws {
        let b = try UpdateButton()
        b.u.site.publish(newFiles)
        _ = await b.u.updater.check()
        #expect(try await b.part.handle(name: "useNewWebBundle", body: .null) == true)
        #expect(b.reloads == [URL(string: "app://local/")!])
    }
}
