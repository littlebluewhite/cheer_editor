// 殼的手感（#376）：包著網頁畫面的那一層，照 ShellCore 的 ScreenFeel 調 WKWebView。規則和為什麼寫在 ScreenFeel。
//
// - 網頁放在不會被瀏海、底下的橫條擋到的範圍裡（safe area），邊邊塗網頁的底色。網頁不用加 viewport-fit=cover。
// - 回彈：網頁說是編輯畫面就不回彈（ScreenPart → kind）。每載入一頁先當是會捲的頁：從編輯畫面整頁換到使用說明，
//   使用說明不用自己說。整頁兩指放大：編輯畫面在網頁那邊擋掉了（src/hooks.client.ts 的 gesturestart），殼不另外擋。
// - 字跟著系統的「文字大小」放大：殼改網頁的 viewport（ScreenFeel.viewport 寫了為什麼不用 pageZoom）。
//   換文字大小、轉方向、iPad 視窗變大小都重算；每一頁載入到 document end 時也問殼一次。
// - 長按連結不跳預覽。
// - 鍵盤：照 Safari 的樣子，網頁畫面不跟著縮小（只接 safe area，不接鍵盤）。
import ShellCore
import UIKit
import WebKit

final class ScreenFeelView: UIView {
    let webView: WKWebView
    private var loading: NSKeyValueObservation?
    /// 現在網頁該用的 viewport（一樣就不再改）。
    fileprivate var viewport = ScreenFeel.viewport(zoom: 1, width: 0)

    /// 殼改 viewport 的程式放在自己的 world，不碰網頁的程式和橋。
    private static let world = WKContentWorld.world(name: "screenFeel")
    /// 每一頁載入到 document end 時問殼現在的 viewport，改上去。
    private static let askOnLoad = WKUserScript(source: """
        webkit.messageHandlers.screenFeel.postMessage(null).then((content) => {
          document.querySelector('meta[name=viewport]')?.setAttribute('content', content);
        });
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: world)

    /// 現在是哪一種畫面（網頁用 ScreenPart 說）。
    var kind: ScreenKind = .page {
        didSet { apply() }
    }

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        backgroundColor = UIColor(red: ScreenFeel.paper.red, green: ScreenFeel.paper.green, blue: ScreenFeel.paper.blue, alpha: 1)
        webView.allowsLinkPreview = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor),
        ])
        loading = webView.observe(\.isLoading) { [weak self] webView, _ in
            MainActor.assumeIsolated {
                if webView.isLoading { self?.kind = .page }
            }
        }
        let scripts = webView.configuration.userContentController
        scripts.addUserScript(Self.askOnLoad)
        scripts.addScriptMessageHandler(ViewportRelay(view: self), contentWorld: Self.world, name: "screenFeel")
        registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (self: Self, _) in self.apply() }
        apply()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("不從 storyboard 建") }

    /// 包著這個網頁畫面的那一層（橋上的一塊從 context.webView 找）。
    static func around(_ webView: WKWebView?) -> ScreenFeelView? {
        webView?.superview as? ScreenFeelView
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        apply()
    }

    private func apply() {
        webView.scrollView.bounces = ScreenFeel.bounces(kind)
        let size = safeAreaLayoutGuide.layoutFrame.size
        guard size.width > 0, size.height > 0 else { return }
        let body = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traitCollection).pointSize
        let zoom = ScreenFeel.zoom(bodySize: body, width: size.width, height: size.height)
        let next = ScreenFeel.viewport(zoom: zoom, width: size.width)
        guard next != viewport else { return }
        viewport = next
        let source = "document.querySelector('meta[name=viewport]')?.setAttribute('content', \(JSONValue.string(next).jsonString))"
        webView.evaluateJavaScript(source, in: nil, in: Self.world)
    }
}

/// WKUserContentController 會一直抓著 handler：中間隔一個弱參照（跟 WebShell 的 MessageRelay 一樣）。
private final class ViewportRelay: NSObject, WKScriptMessageHandlerWithReply {
    weak var view: ScreenFeelView?
    init(view: ScreenFeelView) { self.view = view }

    @MainActor
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        (view?.viewport ?? ScreenFeel.viewport(zoom: 1, width: 0), nil)
    }
}
