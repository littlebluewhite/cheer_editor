// 小樣（#300，比完就丟）：(B) 把現在的網頁包進 app。
// 兩種裝法，點左下角小框的藍字切換（記住，下次打開照用）：
//   包在 app 裡：網頁檔在安裝包裡（Site.bundle），用 app://local/ 開。這一種網頁多了兩個掛鉤（開流程檔、打開就回上次那支）。
//   連到網站：開 https://littlebluewhite.com/（App-Bound Domains，service worker 才開）。網頁照正式站，沒有掛鉤。
import SwiftUI
import WebKit
import AVFAudio

@main struct CheerFeelWebApp: App {
    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback)
    }
    var body: some Scene {
        WindowGroup {
            WebShell().onOpenURL { Shell.shared.open($0) }
        }
    }
}

struct WebShell: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { Shell.shared.container }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

final class Shell: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = Shell()
    let container = UIView()
    private var webView: WKWebView?
    private var loaded = false
    private var pendingJS: String?
    private let defaults = UserDefaults.standard
    private var remote: Bool { get { defaults.bool(forKey: "remote") } set { defaults.set(newValue, forKey: "remote") } }
    private var latencyFix: Bool { get { defaults.bool(forKey: "latencyFix") } set { defaults.set(newValue, forKey: "latencyFix") } }

    override init() {
        super.init()
        container.backgroundColor = .systemBackground
        reload()
    }

    private func reload() {
        webView?.removeFromSuperview()
        loaded = false
        let c = WKWebViewConfiguration()
        c.setURLSchemeHandler(SiteHandler(), forURLScheme: "app")
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        c.limitsNavigationsToAppBoundDomains = remote
        let ucc = WKUserContentController()
        ucc.add(self, name: "shell")
        let hud = (try? String(contentsOf: Bundle.main.url(forResource: "hud", withExtension: "js")!, encoding: .utf8)) ?? ""
        let state = "window.__shellState={mode:'\(remote ? "連到網站" : "包在app裡")',latencyFix:\(latencyFix)};"
        ucc.addUserScript(WKUserScript(source: state + hud, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        c.userContentController = ucc
        let w = WKWebView(frame: container.bounds, configuration: c)
        w.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        w.isInspectable = true
        w.navigationDelegate = self
        container.addSubview(w)
        webView = w
        w.load(URLRequest(url: URL(string: remote ? "https://littlebluewhite.com/" : "app://local/")!))
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any] else { return }
        if let fix = d["latencyFix"] as? Bool { latencyFix = fix }
        if d["toggleMode"] != nil { remote.toggle(); reload() }
    }

    /// 「檔案」App、LINE 傳來的流程檔：先放到 tmp，網頁從 app://local/__incoming/ 拿
    func open(_ url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("incoming")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // 網頁照副檔名認檔：.cheerb 改回 .zip 再給它
        let name = url.deletingPathExtension().lastPathComponent + ".zip"
        try? data.write(to: dir.appendingPathComponent(name))
        let js = """
        (function f(n){ if (window.__appOpenFlow) window.__appOpenFlow(\(jsString(name)), 'app://local/__incoming/' + encodeURIComponent(\(jsString(name))));
          else if (n < 200) setTimeout(function(){ f(n+1) }, 30); })(0)
        """
        if remote { remote = false; reload() }
        if loaded { webView?.evaluateJavaScript(js) } else { pendingJS = js }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let js = pendingJS { pendingJS = nil; webView.evaluateJavaScript(js) }
    }

    private func jsString(_ s: String) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!.dropFirst().dropLast().description
    }
}

final class SiteHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.url(forResource: "Site", withExtension: "bundle")!
    private let fm = FileManager.default

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        let path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        var file: URL?
        if path.hasPrefix("/__incoming/") {
            file = fm.temporaryDirectory.appendingPathComponent("incoming").appendingPathComponent(url.lastPathComponent)
        } else if path.hasPrefix("/api/") {
            file = nil // 包在 app 裡沒有伺服器：當成斷網
        } else {
            let f = root.appendingPathComponent(String(path.dropFirst()))
            if fm.fileExists(atPath: f.path) { file = f }
            else if fm.fileExists(atPath: f.path + ".html") { file = URL(fileURLWithPath: f.path + ".html") }
            else if f.pathExtension.isEmpty { file = root.appendingPathComponent("200.html") }
        }
        let data = file.flatMap { try? Data(contentsOf: $0) }
        let type = mime(file?.pathExtension ?? "")
        let resp = HTTPURLResponse(url: url, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": type, "Content-Length": "\(data?.count ?? 0)", "Cache-Control": "no-cache"])!
        task.didReceive(resp)
        task.didReceive(data ?? Data())
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json"
        case "webmanifest": "application/manifest+json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "ico": "image/x-icon"
        case "wasm": "application/wasm"
        case "txt": "text/plain; charset=utf-8"
        case "woff2": "font/woff2"
        case "wav": "audio/wav"
        default: "application/octet-stream"
        }
    }
}
