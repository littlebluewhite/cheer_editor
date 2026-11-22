// 列印（#391）：叫出系統的列印畫面，印網頁畫面現在這一頁（docs/research/app-print.md）。
// - 內容給 webView.viewPrintFormatter()：WebKit 排版時換成 @media print、照紙張分頁，網頁的列印樣式算數。
// - 背景色用預設（不印，WKPreferences.shouldPrintBackgrounds）；要印的顏色網頁自己標了 print-color-adjust: exact。
// - 存成 PDF、傳給別人走列印畫面上的「分享」，不另外做。
// - 網頁的「列印」經過橋（ShellCore 的 PrintPart）叫 present；⌘P（Info.plist 的 UIApplicationSupportsPrintCommand）走 printContent。
import ShellCore
import UIKit
import WebKit

@MainActor
enum Printer {
    /// iPad 上從按鈕（網頁畫面上的位置）跳出來；沒給位置、或在 iPhone 上，照系統預設的方式出來。
    static func present(_ webView: WKWebView?, from button: PrintButton? = nil) {
        guard let webView, UIPrintInteractionController.isPrintingAvailable else { return }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = webView.title ?? ""
        controller.printInfo = info
        controller.printFormatter = webView.viewPrintFormatter()
        if UIDevice.current.userInterfaceIdiom == .pad {
            let rect = button.map { CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height) }
                ?? CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
            controller.present(from: rect, in: webView, animated: true)
        } else {
            controller.present(animated: true)
        }
    }
}

extension ShellViewController {
    /// ⌘P：印網頁畫面現在這一頁。
    override func printContent(_ sender: Any?) {
        Printer.present(Printer.webView(in: view))
    }
}

extension Printer {
    /// 畫面裡的網頁畫面（包在別層裡也找得到，例：#376 的 ScreenFeelView）。
    static func webView(in view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView { return webView }
        return view.subviews.lazy.compactMap { webView(in: $0) }.first
    }
}
