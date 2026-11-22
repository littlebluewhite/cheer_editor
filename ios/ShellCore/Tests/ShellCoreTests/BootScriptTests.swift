// 殼在 document start 塞進網頁的那段 JS：在 JavaScriptCore 裡跑一次（不用模擬器），看網頁拿到的 window.__cheerShell。
import JavaScriptCore
import Testing
@testable import ShellCore

struct BootScriptTests {
    /// 跑塞進去的 JS；假的 messageHandlers.shell 把送出的字串記在 sent，回 answer。
    func run(boot: [String: JSONValue], answer: String = #"{"reply":null}"#) -> JSContext {
        let js = JSContext()!
        js.evaluateScript("""
            var window = this; var sent = [];
            window.webkit = { messageHandlers: { shell: { postMessage: function (s) { sent.push(s); return Promise.resolve(\(JSONValue.string(answer).jsonString)); } } } };
            """)
        js.evaluateScript(BootScript.source(boot: boot))
        return js
    }

    @Test func 網頁拿得到一開始塞的那份() {
        let js = run(boot: ["shellVersion": "1.0", "shellBuild": 3, "features": ["print"]])
        #expect(js.evaluateScript("JSON.stringify(window.__cheerShell.boot)").toString()
            == #"{"features":["print"],"shellBuild":3,"shellVersion":"1.0"}"#)
    }

    @Test func 塞的字裡有換行_引號_行分隔字元也照樣到() {
        let tricky = "第一行\n\"引號\"\u{2028}</script>"
        let js = run(boot: ["name": .string(tricky)])
        #expect(js.evaluateScript("window.__cheerShell.boot.name").toString() == tricky)
    }

    @Test func 網頁送一句_殼收到的是JSON字串_回的值拆開給網頁() {
        let js = run(boot: [:], answer: #"{"reply":{"ok":true}}"#)
        js.evaluateScript("var got; window.__cheerShell.send('ready').then(function (r) { got = r; });")
        #expect(js.evaluateScript("sent[0]").toString() == #"{"name":"ready","body":null}"#)
        #expect(js.evaluateScript("JSON.stringify(got)").toString() == #"{"ok":true}"#)
    }

    @Test func 殼回錯誤_網頁收到Error() {
        let js = run(boot: [:], answer: #"{"error":"unknown"}"#)
        js.evaluateScript("var failed; window.__cheerShell.send('x', 1).catch(function (e) { failed = e.message; });")
        #expect(js.evaluateScript("failed").toString() == "unknown")
    }

    @Test func 殼主動說的話_有聽的才收到_不聽了就不收() {
        let js = run(boot: [:])
        js.evaluateScript("var heard = []; var stop = window.__cheerShell.on('ping', function (b) { heard.push(b.n); });")
        js.evaluateScript(Bridge.eventScript(name: "ping", body: ["n": 1]))
        js.evaluateScript(Bridge.eventScript(name: "other", body: ["n": 2]))
        js.evaluateScript("stop();")
        js.evaluateScript(Bridge.eventScript(name: "ping", body: ["n": 3]))
        #expect(js.evaluateScript("JSON.stringify(heard)").toString() == "[1]")
    }
}
