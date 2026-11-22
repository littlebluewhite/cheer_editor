// 殼的手感（#376）在真的 WKWebView 上：邊邊、回彈、字跟著系統放大、長按連結。規則本身在 ShellCore 的 ScreenFeel（swift test）。
// 手勢（兩指放大、長按）這裡做不出來：只看殼設的值對不對。
import ShellCore
import Testing
import UIKit
import WebKit
@testable import CheerEditor

@MainActor
@Suite(.serialized)
struct ScreenFeelPipeTests {
    /// 跟 App 一樣接：網頁畫面包在 ScreenFeelView 裡，ScreenPart 從 context 找到它。放進 App 的視窗場景，才有真的瀏海、橫條。
    func shell(size: CGSize? = nil) throws -> (Harness, ScreenFeelView) {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        let h = Harness(siteRoot: site, parts: { context in
            [ScreenPart(onScreen: { ScreenFeelView.around(context.webView)?.kind = $0 })]
        })
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        h.window.windowScene = scene
        h.window.frame = size.map { CGRect(origin: .zero, size: $0) } ?? scene.coordinateSpace.bounds
        h.shell.webView.removeFromSuperview()
        let feel = ScreenFeelView(webView: h.shell.webView)
        feel.frame = h.window.bounds
        feel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        h.window.addSubview(feel)
        h.window.makeKeyAndVisible()
        feel.layoutIfNeeded()
        return (h, feel)
    }

    @Test func 網頁放在不會被擋的範圍裡_邊邊是網頁的底色_長按連結不預覽() async throws {
        let (h, feel) = try shell()
        defer { h.window.isHidden = true }
        try await h.load("")
        #expect(h.shell.webView.frame == feel.safeAreaLayoutGuide.layoutFrame)
        #expect(feel.safeAreaInsets.top > 0, "模擬器要是有瀏海或狀態列的機型")
        let paper = try #require(try await h.js("return getComputedStyle(document.body).backgroundColor") as? String)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        feel.backgroundColor?.getRed(&r, green: &g, blue: &b, alpha: &a)
        #expect(paper == "rgb(\(Int(r * 255)), \(Int(g * 255)), \(Int(b * 255)))")
        #expect(h.shell.webView.allowsLinkPreview == false)
    }

    @Test func 編輯畫面不回彈_整頁換到使用說明又回彈() async throws {
        // iPad 橫拿的大小才能新建流程
        let (h, _) = try shell(size: CGSize(width: 1194, height: 834))
        defer { h.window.isHidden = true }
        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        #expect(h.shell.webView.scrollView.bounces == true)
        let script = try String(contentsOf: fixtures.appendingPathComponent("new-flow-play.js"), encoding: .utf8)
        _ = try await h.js(script)
        try await h.waitUntil("編輯畫面不回彈") { h.shell.webView.scrollView.bounces == false }
        // 使用說明的連結在原地開（ios/README.md 的已知問題）：整頁換掉，編輯畫面沒機會說「離開了」
        try await h.load("guide")
        #expect(h.shell.webView.scrollView.bounces == true)
    }

    @Test func 字跟著系統的文字大小放大_重排不超出畫面_能編輯的iPad放到剛好還能編輯() async throws {
        // iPad mini 橫拿的大小
        let (h, feel) = try shell(size: CGSize(width: 1133, height: 744))
        defer { h.window.isHidden = true }
        feel.traitOverrides.preferredContentSizeCategory = .large
        try await h.load("")
        let size = feel.safeAreaLayoutGuide.layoutFrame.size
        let layout = "return [innerWidth, document.body.getBoundingClientRect().width, document.documentElement.scrollWidth, matchMedia('screen and (max-width: 1023px), screen and (max-height: 599px)').matches]"
        func seen() async -> [Double] {
            ((try? await h.js(layout)) as? [Any] ?? []).map { ($0 as? Double) ?? (($0 as? Bool) == true ? 1 : 0) }
        }
        #expect(await seen() == [size.width, size.width, size.width, 0])

        feel.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        feel.layoutIfNeeded()
        let zoom = ScreenFeel.zoom(bodySize: 53, width: size.width, height: size.height)
        #expect(zoom > 1)
        let want = (size.width / zoom).rounded(.down)
        // 網頁看到的寬、版面的寬、能捲的寬都是放大後的寬（沒有一截跑出畫面）；還是能編輯的大小
        try await h.waitUntil("照放大後的寬重排") { await seen() == [want, want, want, 0] }

        // 換一頁也照現在的放大
        try await h.load("guide")
        try await h.waitUntil("換頁後也放大") { await seen().prefix(3) == [want, want, want] }
    }
}
