// 鎖定畫面的播放鍵（#389），真的 WKWebView、真的那包網頁：網頁播了跟殼說；殼按暫停、播放，網頁真的停、真的播。
// 系統的鎖定畫面（MPNowPlayingInfoCenter、MPRemoteCommandCenter）模擬器驗不了，這裡從 NowPlayingPart.press 按。
import ShellCore
import Testing
import UIKit

@MainActor
@Suite(.serialized)
struct LockScreenPipeTests {
    @Test func 真的那包網頁_播放後鎖定畫面按暫停再按播放() async throws {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let script = try String(contentsOf: fixtures.appendingPathComponent("new-flow-play.js"), encoding: .utf8)
        var shown: [NowPlaying?] = []
        var part: NowPlayingPart!
        let h = Harness(siteRoot: site, parts: { context in
            part = NowPlayingPart(outbox: context.outbox, show: { shown.append($0) })
            return [part]
        }, size: CGSize(width: 1194, height: 834))
        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        #expect(try await h.js(script) as? String == "新建了、放了音樂、在播")
        try await h.waitUntil("網頁跟殼說在播") { shown.last == NowPlaying(title: "管子測試", playing: true) }

        let button = "return document.querySelector('button[aria-label=\"暫停\"]') ? '暫停' : document.querySelector('button[aria-label=\"播放\"]') ? '播放' : ''"
        #expect(part.press(.pause))
        try await h.waitUntil("按鈕變回播放") { (try? await h.js(button)) as? String == "播放" }
        try await h.waitUntil("網頁跟殼說停了") { shown.last == NowPlaying(title: "管子測試", playing: false) }

        // 不是使用者在網頁上按的（沒有手勢）：WebKit 讓不讓 AudioContext 接著出聲，真機才知道（#387）
        #expect(part.press(.play))
        try await h.waitUntil("按鈕變成暫停") { (try? await h.js(button)) as? String == "暫停" }
        try await h.waitUntil("網頁跟殼說又在播") { shown.last == NowPlaying(title: "管子測試", playing: true) }
    }
}
