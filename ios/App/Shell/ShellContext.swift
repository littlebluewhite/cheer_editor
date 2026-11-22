// 橋上每一塊、自訂網址上每一條路拿得到的東西（ShellParts.all、SchemeRoutes.all 收這個）。
// 網頁畫面比橋晚建好（橋要先有，才知道一開始塞什麼），所以 webShell 是建好以後才接上。
import ShellCore
import WebKit

@MainActor
final class ShellContext {
    /// 殼主動跟網頁說話：傳給要說話的那一塊（ShellCore 的 ShellOutbox）。
    let outbox = ShellOutbox()
    private(set) weak var webShell: WebShell?

    /// 網頁畫面（列印、重新載入要用）。接上之前是 nil。
    var webView: WKWebView? { webShell?.webView }

    /// 網頁說「好了」（ReadyPart）時要叫的：要聽的那一塊在 ShellParts.swift 自己那一格加。
    var onReady: [@MainActor () -> Void] = []

    func webSaidReady() {
        onReady.forEach { $0() }
    }

    func attach(_ shell: WebShell) {
        webShell = shell
        outbox.deliver = { [weak shell] name, body in shell?.emit(name, body) }
    }
}
