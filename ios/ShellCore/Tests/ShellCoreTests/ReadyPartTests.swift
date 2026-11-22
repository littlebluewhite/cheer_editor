// 網頁畫面出來以後跟殼說「好了」（#375；ADR 0025 用它判斷新網頁打不打得開）。
import Testing
import ShellCore

@MainActor
struct ReadyPartTests {
    @Test func 網頁說好了_殼記下來() async {
        var heard = 0
        let bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [ReadyPart(onReady: { heard += 1 })])
        #expect(await bridge.handle(name: "ready", body: nil) == .reply(nil))
        #expect(heard == 1)
    }

    @Test func 好了不算一件會的事() {
        #expect(Bridge(shellVersion: "1", shellBuild: 1, parts: [ReadyPart(onReady: {})]).features == [])
    }
}
