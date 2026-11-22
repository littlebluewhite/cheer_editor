// 鎖定畫面的播放鍵（#389）：網頁說現在播什麼，殼顯示在鎖定畫面；鎖定畫面按了播放、暫停，殼叫網頁播、停。
import Testing
import ShellCore

@MainActor
struct NowPlayingPartTests {
    /// 一塊 NowPlayingPart：記下鎖定畫面顯示了什麼、殼跟網頁說了什麼。
    @MainActor final class Setup {
        var shown: [NowPlaying?] = []
        var said: [JSONValue] = []
        let part: NowPlayingPart
        let bridge: Bridge

        init() {
            let outbox = ShellOutbox()
            var shown: (NowPlaying?) -> Void = { _ in }
            part = NowPlayingPart(outbox: outbox, show: { shown($0) })
            bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [part])
            shown = { [unowned self] in self.shown.append($0) }
            outbox.deliver = { [unowned self] name, body in self.said.append(["name": .string(name), "body": body]) }
        }
    }

    @Test func 會的事叫nowPlaying() {
        #expect(Setup().bridge.features == ["nowPlaying"])
    }

    @Test func 網頁說在播_鎖定畫面顯示流程的名字和在播() async {
        let s = Setup()
        #expect(await s.bridge.handle(name: "nowPlaying", body: ["title": "全國賽", "playing": true]) == .reply(nil))
        #expect(s.shown == [NowPlaying(title: "全國賽", playing: true)])
    }

    @Test func 網頁說沒東西播_鎖定畫面收掉() async {
        let s = Setup()
        _ = await s.bridge.handle(name: "nowPlaying", body: ["title": "全國賽", "playing": true])
        #expect(await s.bridge.handle(name: "nowPlaying", body: nil) == .reply(nil))
        #expect(s.shown == [NowPlaying(title: "全國賽", playing: true), nil])
    }

    @Test func 網頁說的看不懂_回失敗_鎖定畫面不動() async {
        let s = Setup()
        #expect(await s.bridge.handle(name: "nowPlaying", body: ["title": 3]) == .error("failed"))
        #expect(s.shown == [])
    }

    @Test func 按播放_按暫停_殼叫網頁播停() async {
        let s = Setup()
        _ = await s.bridge.handle(name: "nowPlaying", body: ["title": "全國賽", "playing": false])
        #expect(s.part.press(.play))
        #expect(s.part.press(.pause))
        #expect(s.said == [["name": "remote", "body": ["command": "play"]], ["name": "remote", "body": ["command": "pause"]]])
    }

    @Test func 耳機的播放暫停鍵_在播就停_停著就播() async {
        let s = Setup()
        _ = await s.bridge.handle(name: "nowPlaying", body: ["title": "全國賽", "playing": true])
        #expect(s.part.press(.togglePlayPause))
        _ = await s.bridge.handle(name: "nowPlaying", body: ["title": "全國賽", "playing": false])
        #expect(s.part.press(.togglePlayPause))
        #expect(s.said == [["name": "remote", "body": ["command": "pause"]], ["name": "remote", "body": ["command": "play"]]])
    }

    @Test func 鎖定畫面沒東西時按了_不叫網頁() async {
        let s = Setup()
        #expect(!s.part.press(.play))
        _ = await s.bridge.handle(name: "nowPlaying", body: ["title": "全國賽", "playing": true])
        _ = await s.bridge.handle(name: "nowPlaying", body: nil)
        #expect(!s.part.press(.togglePlayPause))
        #expect(s.said == [])
    }
}
