// 列印（#391，情境 bridge-scenarios/current/print.json）：網頁按「列印」，殼叫出系統的列印畫面。
import Testing
import ShellCore

@MainActor
struct PrintPartTests {
    @Test func 網頁說按鈕在哪_殼從那裡叫出列印畫面() async {
        var asked: [PrintButton?] = []
        let bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [PrintPart(onPrint: { asked.append($0) })])
        let body: JSONValue = ["button": ["x": 10, "y": 20.5, "width": 80, "height": 32]]
        #expect(await bridge.handle(name: "print", body: body) == .reply(nil))
        #expect(asked == [PrintButton(x: 10, y: 20.5, width: 80, height: 32)])
    }

    @Test func 沒說或說不清楚按鈕在哪_照樣印_不給位置() async {
        var asked: [PrintButton?] = []
        let bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [PrintPart(onPrint: { asked.append($0) })])
        _ = await bridge.handle(name: "print", body: nil)
        _ = await bridge.handle(name: "print", body: ["button": ["x": "左邊"]])
        #expect(asked == [nil, nil])
    }

    @Test func 會列印() {
        #expect(Bridge(shellVersion: "1", shellBuild: 1, parts: [PrintPart(onPrint: { _ in })]).features == ["print"])
    }
}
