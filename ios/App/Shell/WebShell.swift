// 網頁畫面（WKWebView）和橋怎麼接（#375）。規則在 ShellCore（BundledSite、NavigationPolicy、Bridge）；這裡只接 WebKit。
//
// - 自訂網址 app://local/ 由 SchemeHandler 送 App 裡那包網頁（不連到網站，不設 App-Bound Domains）。
// - document start 塞 BootScript（window.__cheerShell）。
// - 網頁 → 殼：messageHandlers.shell（有回覆），只收這包網頁送的。殼 → 網頁：emit。
// - 網頁畫面只開這包網頁；外面的連結交給 Safari（NavigationPolicy）。
import ShellCore
import UIKit
import WebKit

@MainActor
final class WebShell: NSObject {
    let webView: WKWebView
    let bridge: Bridge
    private let openOutside: (URL) -> Void

    init(
        siteRoot: URL,
        bridge: Bridge,
        routes: [any SchemeRoute],
        openOutside: @escaping (URL) -> Void = { UIApplication.shared.open($0) }
    ) {
        self.bridge = bridge
        self.openOutside = openOutside
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(siteRoot: siteRoot, routes: routes), forURLScheme: BundledSite.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.limitsNavigationsToAppBoundDomains = false
        config.userContentController.addUserScript(WKUserScript(
            source: BootScript.source(boot: bridge.boot), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.addScriptMessageHandler(MessageRelay(shell: self), contentWorld: .page, name: "shell")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
    }

    /// 殼主動跟網頁說一句（網頁用 __cheerShell.on(name, fn) 收）。
    func emit(_ name: String, _ body: JSONValue = nil) {
        webView.evaluateJavaScript(Bridge.eventScript(name: name, body: body))
    }

    fileprivate func receive(_ message: WKScriptMessage) async -> String {
        // 殼只聽自己那包網頁說的話
        let origin = message.frameInfo.securityOrigin
        guard origin.protocol == BundledSite.scheme, origin.host == BundledSite.host, let raw = message.body as? String else {
            return JSONValue.object(["error": "bad message"]).jsonString
        }
        return await bridge.handle(raw: raw)
    }

    private func decide(_ url: URL?) -> Bool {
        guard let url else { return false }
        switch NavigationPolicy.decide(url) {
        case .allow: return true
        case .openOutside: openOutside(url); return false
        case .block: return false
        }
    }
}

/// WKUserContentController 會一直抓著 handler：中間隔一個弱參照，WebShell 才放得掉。
private final class MessageRelay: NSObject, WKScriptMessageHandlerWithReply {
    weak var shell: WebShell?
    init(shell: WebShell) { self.shell = shell }

    @MainActor
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let shell else { return (nil, "shell gone") }
        return (await shell.receive(message), nil)
    }
}

extension WebShell: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        decide(action.request.url) ? .allow : .cancel
    }

    /// target=_blank、window.open：App 只有一個畫面，自己的頁面就在原地開，外面的交給 Safari。
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if decide(action.request.url) { webView.load(action.request) }
        return nil
    }
}
