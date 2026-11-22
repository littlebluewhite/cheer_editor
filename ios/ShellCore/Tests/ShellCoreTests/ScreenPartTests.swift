// 殼的手感（#376）：網頁說現在是哪一種畫面，殼決定回不回彈；字跟著系統放大，有上限；邊邊塗網頁的底色。
import Foundation
import Testing
import ShellCore

@MainActor
struct ScreenPartTests {
    @Test func 網頁說現在是編輯畫面_殼記下來() async {
        var heard: [ScreenKind] = []
        let bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [ScreenPart(onScreen: { heard.append($0) })])
        #expect(await bridge.handle(name: "screen", body: ["kind": "editor"]) == .reply(nil))
        #expect(await bridge.handle(name: "screen", body: ["kind": "page"]) == .reply(nil))
        #expect(heard == [.editor, .page])
    }

    @Test func 不認得的畫面回錯誤() async {
        var heard: [ScreenKind] = []
        let bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [ScreenPart(onScreen: { heard.append($0) })])
        #expect(await bridge.handle(name: "screen", body: ["kind": "menu"]) == .error("failed"))
        #expect(await bridge.handle(name: "screen", body: nil) == .error("failed"))
        #expect(heard == [])
    }

    @Test func 網頁問得到殼會分畫面() {
        #expect(Bridge(shellVersion: "1", shellBuild: 1, parts: [ScreenPart(onScreen: { _ in })]).features == ["screen"])
    }
}

struct ScreenFeelTests {
    @Test func 編輯畫面不回彈_會捲的頁照樣回彈() {
        #expect(ScreenFeel.bounces(.editor) == false)
        #expect(ScreenFeel.bounces(.page) == true)
    }

    @Test func 邊邊的顏色跟網頁的底色一樣() throws {
        let css = try String(contentsOf: repoRoot.appendingPathComponent("src/app.css"), encoding: .utf8)
        let paper = try #require(css.firstMatch(of: /--paper:\s*(#[0-9a-fA-F]{6});/)?.1)
        #expect(ScreenFeel.paper.hex == paper.lowercased())
    }
}

struct ZoomTests {
    func zoom(_ body: Double, _ w: Double, _ h: Double) -> Double { ScreenFeel.zoom(bodySize: body, width: w, height: h) }

    @Test func 系統文字大小是預設_不放大() {
        #expect(zoom(17, 1133, 700) == 1)
        #expect(zoom(17, 402, 778) == 1)
    }

    @Test func 字跟著系統放大縮小() {
        #expect(zoom(21, 1376, 990) == 21.0 / 17)
        #expect(zoom(14, 402, 778) == 14.0 / 17)
    }

    @Test func 能編輯的iPad_放大到剛好還能編輯就停() {
        // iPad mini 橫拿（安全範圍 1133×700）：1133 / 1.10 = 1030 ≥ 1024；1.11 就只剩 1020，變成窄螢幕
        #expect(zoom(53, 1133, 700) == 1.10)
        // 13 吋 iPad Pro 橫拿：寬度先到（1376 / 1024 = 1.34；高度 990 / 600 = 1.65）
        #expect(zoom(53, 1376, 990) == 1.34)
    }

    @Test(arguments: [(1133.0, 700.0), (1180, 776), (1210, 790), (1376, 990), (1024, 600), (1100, 610)])
    func 放大後的寬高一定還夠編輯(_ size: (Double, Double)) {
        let (w, h) = size
        let z = zoom(53, w, h)
        #expect(w / z >= ScreenFeel.editMinWidth && h / z >= ScreenFeel.editMinHeight, "\(w)×\(h) 放大 \(z)")
    }

    @Test func 手機和拿直的iPad_放大到短的那邊剩320() {
        #expect(zoom(53, 375, 647) == 1.17)   // iPhone SE
        #expect(zoom(53, 402, 778) == 1.25)   // iPhone 17
        #expect(zoom(53, 874, 360) == 1.12)   // iPhone 橫拿：高度比較短
        #expect(zoom(53, 744, 1089) == 2.32)  // iPad mini 拿直的
    }

    @Test func 很小的畫面不放大_但系統的字調小照樣縮() {
        #expect(zoom(23, 300, 500) == 1)
        #expect(zoom(14, 300, 500) == 14.0 / 17)
    }

    @Test func 放大是改網頁的viewport_寫明放大後的寬() {
        #expect(ScreenFeel.viewport(zoom: 1, width: 375) == "width=device-width, initial-scale=1")
        #expect(ScreenFeel.viewport(zoom: 1.25, width: 375) == "width=300, initial-scale=1.25")
        #expect(ScreenFeel.viewport(zoom: 1.1, width: 1133) == "width=1030, initial-scale=1.1")
        #expect(ScreenFeel.viewport(zoom: 14.0 / 17, width: 375) == "width=455, initial-scale=\(14.0 / 17)")
    }

    @Test func 系統預設的viewport跟網頁的app_html一樣() throws {
        let html = try String(contentsOf: repoRoot.appendingPathComponent("src/app.html"), encoding: .utf8)
        #expect(html.contains("<meta name=\"viewport\" content=\"\(ScreenFeel.viewport(zoom: 1, width: 0))\" />"))
    }

    @Test func 能編輯的大小跟網頁一樣() throws {
        let ts = try String(contentsOf: repoRoot.appendingPathComponent("src/lib/editor-layout.ts"), encoding: .utf8)
        #expect(ts.contains("const EDIT_MIN_W_PX = \(Int(ScreenFeel.editMinWidth));"))
        #expect(ts.contains("const EDIT_MIN_H_PX = \(Int(ScreenFeel.editMinHeight));"))
    }
}

/// repo 根目錄（這個檔在 ios/ShellCore/Tests/ShellCoreTests/）。
let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
