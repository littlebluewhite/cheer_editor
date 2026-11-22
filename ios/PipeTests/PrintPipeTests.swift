// 列印（#391）在真的 WKWebView 上：網頁的「列印」經過橋請殼叫出系統的列印畫面；⌘P 由殼接（printContent）。
// 列印畫面是系統的（不在 App 的畫面裡），上面有沒有「分享」看截圖：TEST_RUNNER_PRINT_HOLD=秒數 xcodebuild … test，
// 列印畫面會多留那麼久，期間 xcrun simctl io <UDID> screenshot。
// 八拍表也用同一種 formatter 排成 A4 的 PDF（跟電腦 Chrome 印的比），路徑印在「八拍表 PDF」那一行。
import Foundation
import ShellCore
import Testing
import UIKit
import WebKit
@testable import CheerEditor

/// 記下列印畫面出來了幾次。
@MainActor
final class PrintSpy: NSObject, UIPrintInteractionControllerDelegate {
    var presented = 0
    func printInteractionControllerDidPresentPrinterOptions(_ controller: UIPrintInteractionController) { presented += 1 }
}

@MainActor
@Suite(.serialized)
struct PrintPipeTests {
    @Test func 真的那包網頁_八拍表按列印_殼叫出列印畫面_網頁在印() async throws {
        let site = try #require(Bundle.main.url(forResource: "Web", withExtension: "bundle"), "先跑 npm run ios:web")
        // 範例流程直接讀 repo 裡的（模擬器讀得到 Mac 上的檔）
        let sample = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../docs/samples/sample-flow.zip")
        let zip = try Data(contentsOf: sample).base64EncodedString()
        let print = try String(contentsOf: fixtures.appendingPathComponent("print-eight-sheet.js"), encoding: .utf8)
        let h = Harness(siteRoot: site,
                        parts: { context in [PrintPart(onPrint: { Printer.present(context.webView, from: $0) })] },
                        size: CGSize(width: 1194, height: 834))
        // 列印畫面要從一個有 view controller 的視窗跳出來（App 裡是 ShellViewController）
        let host = UIViewController()
        h.window.rootViewController = host
        host.view.addSubview(h.shell.webView)
        h.window.makeKeyAndVisible()
        let spy = PrintSpy()
        UIPrintInteractionController.shared.delegate = spy
        defer {
            UIPrintInteractionController.shared.dismiss(animated: false)
            UIPrintInteractionController.shared.delegate = nil
        }

        try await h.load("")
        try await h.waitUntil("網頁說好了") { h.readyCount >= 1 }
        let hint = try await h.js(print, ["zip": zip]) as? String
        #expect(hint == "按「列印」。要存成 PDF 或傳給別人，在列印畫面按「分享」。")

        try await h.waitUntil("列印畫面出來") { spy.presented == 1 }
        let formatter = UIPrintInteractionController.shared.printFormatter as? UIViewPrintFormatter
        #expect(formatter?.view === h.shell.webView)
        // 系統排預覽時 WebKit 換成列印的樣子：網頁收到 beforeprint
        try await h.waitUntil("網頁收到 beforeprint", seconds: 15) {
            ((try? await h.js("return window.printEvents.join(',')")) as? String ?? "").contains("beforeprint")
        }
        Swift.print("八拍表 PDF｜\(Self.pdf(of: h.shell.webView, name: "eight-sheet.pdf").path)")
        if let hold = ProcessInfo.processInfo.environment["PRINT_HOLD"].flatMap(Double.init) {
            try await Task.sleep(for: .seconds(hold))
        }
        // 收乾淨再換下一個測試（剛收就再叫，系統不理；程式收起來不會通知 delegate，只好等一下）
        UIPrintInteractionController.shared.dismiss(animated: false)
        try await Task.sleep(for: .seconds(1))
    }

    @Test func 按Command_P_殼接_印現在這一頁() async throws {
        #expect(Bundle.main.object(forInfoDictionaryKey: "UIApplicationSupportsPrintCommand") as? Bool == true)
        // 測試跑在 App 裡：App 自己的 ShellViewController 開著那包網頁
        let found = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows }.joined()
            .compactMap { $0.rootViewController as? ShellViewController }
        let shellVC = try #require(found.first)
        let webView = try #require(shellVC.view.subviews.compactMap { $0 as? WKWebView }.first, "先跑 npm run ios:web")
        shellVC.view.window?.makeKeyAndVisible()
        let spy = PrintSpy()
        UIPrintInteractionController.shared.delegate = spy
        defer {
            UIPrintInteractionController.shared.dismiss(animated: false)
            UIPrintInteractionController.shared.delegate = nil
        }
        // ⌘P 從網頁畫面（裡面的 WKContentView）往上找 printContent：WebKit 不接，到 ShellViewController
        let action = #selector(UIResponder.printContent(_:))
        let content = webView.scrollView.subviews.first { String(describing: type(of: $0)).contains("ContentView") }
        #expect((content ?? webView).target(forAction: action, withSender: nil) as AnyObject? === shellVC)

        // 焦點在網頁裡（點過網頁）時按 ⌘P
        (content ?? webView).becomeFirstResponder()
        #expect(UIApplication.shared.sendAction(action, to: nil, from: nil, for: nil))
        try await Self.waitUntil { spy.presented == 1 }
        #expect((UIPrintInteractionController.shared.printFormatter as? UIViewPrintFormatter)?.view === webView)
    }

    /// 用網頁畫面的列印 formatter 排成 A4（四邊 36 pt）的 PDF，存在模擬器的暫存資料夾。
    static func pdf(of webView: WKWebView, name: String) -> URL {
        let renderer = A4Renderer()
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? UIGraphicsPDFRenderer(bounds: renderer.paperRect).writePDF(to: url) { context in
            renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
            for page in 0..<renderer.numberOfPages {
                context.beginPage()
                renderer.drawPage(at: page, in: renderer.paperRect)
            }
        }
        return url
    }

    static func waitUntil(seconds: Double = 10, _ check: () -> Bool) async throws {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end, !check() { try await Task.sleep(for: .milliseconds(50)) }
        #expect(check(), "等不到")
    }
}

/// A4 紙（595×842 pt），四邊留 36 pt。
final class A4Renderer: UIPrintPageRenderer {
    override var paperRect: CGRect { CGRect(x: 0, y: 0, width: 595.2, height: 841.8) }
    override var printableRect: CGRect { paperRect.insetBy(dx: 36, dy: 36) }
}
