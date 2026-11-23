// 使用說明的「App 裡：…」（#398）在真的 WKWebView 上：預先產生的頁面是網頁版（沒有那幾段），網頁程式接手後要補上。
import Testing
import UIKit
@testable import CheerEditor

@MainActor
@Suite(.serialized, .timeLimit(.minutes(1)))
struct GuidePipeTests {
    @Test func 真的那包網頁_App裡打開使用說明_看得到App裡的段落() async throws {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let h = Harness(siteRoot: site)
        try await h.load("guide")
        let count = "return [...document.querySelectorAll('.app')].filter((e) => e.textContent.trim().startsWith('App 裡：')).length"
        try await h.waitUntil("看得到「App 裡：」的段落") { (try? await h.js(count)) as? Int ?? 0 > 0 }
        #expect(try await h.js(count) as? Int == 8)
    }
}
