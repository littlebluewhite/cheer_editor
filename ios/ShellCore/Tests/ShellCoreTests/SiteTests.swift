// 包在 App 裡的網頁：自訂網址對到哪個檔；網頁畫面只開這包，外面的連結交給 Safari。
import Foundation
import Testing
import ShellCore

struct BundledSiteTests {
    let files: Set<String> = ["index.html", "200.html", "guide.html", "_app/immutable/start.js", "favicon.svg"]
    func file(_ path: String) -> String? { BundledSite.file(forPath: path, exists: files.contains) }

    @Test func 首頁是index() {
        #expect(file("/") == "index.html")
        #expect(file("") == "index.html")
    }

    @Test func 有這個檔就給它() {
        #expect(file("/_app/immutable/start.js") == "_app/immutable/start.js")
    }

    @Test func 沒有副檔名的頁面照建置存的名字html() {
        #expect(file("/guide") == "guide.html")
    }

    @Test func 沒有建好的頁面給200html_網頁自己處理路由() {
        #expect(file("/flows/abc") == "200.html")
    }

    @Test func 沒有的檔案不給() {
        #expect(file("/missing.js") == nil)
    }

    @Test func 跑不出這包網頁的資料夾() {
        #expect(file("/../secret.txt") == nil)
        #expect(file("/_app/../../x.js") == nil)
    }

    @Test func 照副檔名給內容的種類() {
        #expect(BundledSite.mimeType(forPath: "index.html") == "text/html; charset=utf-8")
        #expect(BundledSite.mimeType(forPath: "_app/a.js") == "text/javascript; charset=utf-8")
        #expect(BundledSite.mimeType(forPath: "x.unknown") == "application/octet-stream")
    }
}

struct NavigationPolicyTests {
    func decide(_ s: String) -> NavigationDecision { NavigationPolicy.decide(URL(string: s)!) }

    @Test func 這包網頁自己的頁面在App裡開() {
        #expect(decide("app://local/") == .allow)
        #expect(decide("app://local/guide?from=editor#top") == .allow)
    }

    @Test func 外面的網站交給Safari() {
        #expect(decide("https://littlebluewhite.com/") == .openOutside)
        #expect(decide("http://example.com/x") == .openOutside)
        #expect(decide("mailto:support@example.com") == .openOutside)
    }

    @Test func 網頁自己做的空白頁和blob留在App裡() {
        #expect(decide("about:blank") == .allow)
        #expect(decide("about:srcdoc") == .allow)
        #expect(decide("blob:app://local/1234-5678") == .allow)
    }

    @Test func 別的自訂網址和別的來源的blob不開() {
        #expect(decide("app://other/") == .block)
        #expect(decide("file:///etc/passwd") == .block)
        #expect(decide("javascript:alert(1)") == .block)
        #expect(decide("blob:https://evil.example/1234") == .block)
    }
}
