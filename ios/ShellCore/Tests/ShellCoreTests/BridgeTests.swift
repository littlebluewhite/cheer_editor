// 橋（網頁和殼之間說的話）：網頁送一句、殼回一句；一開始塞給網頁的那份。
import Testing
@testable import ShellCore

@MainActor
struct BridgeTests {
    struct Echo: BridgePart {
        var feature: String? { "echo" }
        var messages: Set<String> { ["echo"] }
        var boot: [String: JSONValue] { ["echoPrefix": "> "] }
        func handle(name: String, body: JSONValue) async throws -> JSONValue { body }
    }

    struct Broken: BridgePart {
        struct Oops: Error {}
        var messages: Set<String> { ["broken"] }
        func handle(name: String, body: JSONValue) async throws -> JSONValue { throw Oops() }
    }

    let bridge = Bridge(shellVersion: "1.2.0", shellBuild: 7, parts: [Echo(), Broken()])

    @Test func 一開始塞的有殼的版本和會什麼() {
        #expect(bridge.boot == [
            "shellVersion": "1.2.0",
            "shellBuild": 7,
            "features": ["echo"],
            "echoPrefix": "> ",
        ])
    }

    @Test func 認得的話照那一塊回() async {
        #expect(await bridge.handle(name: "echo", body: ["a": 1]) == .reply(["a": 1]))
    }

    @Test func 不認得的話回錯誤unknown() async {
        #expect(await bridge.handle(name: "noSuchThing", body: nil) == .error("unknown"))
    }

    @Test func 那一塊出錯回錯誤failed() async {
        #expect(await bridge.handle(name: "broken", body: nil) == .error("failed"))
    }

    @Test func 網頁送來的是JSON字串_回的也是() async {
        #expect(await bridge.handle(raw: #"{"name":"echo","body":[1,"x"]}"#) == #"{"reply":[1,"x"]}"#)
        #expect(await bridge.handle(raw: #"{"name":"noSuchThing"}"#) == #"{"error":"unknown"}"#)
        #expect(await bridge.handle(raw: "not json") == #"{"error":"bad message"}"#)
    }

    @Test func 殼主動說的話包成一行JS() {
        #expect(Bridge.eventScript(name: "ping", body: ["n": 1])
            == #"window.__cheerShell && window.__cheerShell.receive({"body":{"n":1},"name":"ping"})"#)
    }
}
