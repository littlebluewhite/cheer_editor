// 喇叭和延遲（#388）。網頁和殼說的話在 bridge-scenarios/current/speaker.json（ScenarioTests 跑）；
// 這裡測情境測不到的：關掉再開還記得、系統說 2000 毫秒照給、認不得的當新喇叭、哪些斷線才停。uid 都是編的。
import Foundation
import Testing
import ShellCore

let builtIn = AudioOutput(portType: "Speaker", uid: "built-in", name: "iPhone 喇叭")
let bluetooth = AudioOutput(portType: "BluetoothA2DPOutput", uid: "aa-bb", name: "練習場喇叭")

/// 假的喇叭：現在接哪個、系統說的延遲。換喇叭照 script 一步一步來（情境用）。
@MainActor
final class FakeAudioRoute {
    var route: AudioRoute
    /// 每次 change() 走一步：換到哪個喇叭、系統說的延遲、是不是舊的那個斷線了。
    var script: [(AudioRoute, Bool)] = [
        (AudioRoute(output: bluetooth, systemLatencyMs: 112), false),
        (AudioRoute(output: builtIn, systemLatencyMs: 10), false),
    ]
    weak var part: SpeakerPart?

    init(_ route: AudioRoute = AudioRoute(output: builtIn, systemLatencyMs: 10)) {
        self.route = route
    }

    func read() -> AudioRoute { route }

    /// 照 script 換下一個喇叭，通知那一塊（App 裡是 routeChangeNotification）。
    func change() {
        let (next, gone) = script.removeFirst()
        go(to: next, oldDeviceUnavailable: gone)
    }

    func go(to next: AudioRoute, oldDeviceUnavailable: Bool = false) {
        let previous = route.output
        route = next
        part?.routeChanged(previous: previous, oldDeviceUnavailable: oldDeviceUnavailable)
    }
}

private extension JSONValue {
    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { o[key] } else { nil }
    }
}

extension SpeakerLatencies {
    /// 情境用：暫存資料夾裡的空的一份（每個喇叭從 0 開始）。
    static func forScenario() -> SpeakerLatencies {
        SpeakerLatencies(url: emptyFolder().appendingPathComponent("speaker-latency.json"))
    }
}

@MainActor
struct SpeakerPartTests {
    @MainActor final class Setup {
        let route = FakeAudioRoute()
        var said: [JSONValue] = []
        let part: SpeakerPart
        let bridge: Bridge

        init(latencies: SpeakerLatencies = .forScenario(), debug: Bool = false) {
            let outbox = ShellOutbox()
            part = SpeakerPart(latencies: latencies, outbox: outbox, read: { [route] in route.read() }, debug: debug)
            route.part = part
            bridge = Bridge(shellVersion: "1", shellBuild: 1, parts: [part])
            outbox.deliver = { [unowned self] name, body in self.said.append(["name": .string(name), "body": body]) }
        }
    }

    @Test func 會的事叫speaker_一開始塞現在的喇叭() {
        let s = Setup()
        #expect(s.bridge.features == ["speaker"])
        #expect(s.part.boot == ["speaker": ["id": "Speaker|built-in", "name": "iPhone 喇叭", "systemLatencyMs": 10, "latencyMs": 0]])
    }

    @Test func 換喇叭_用那個喇叭的值_新喇叭是0() async {
        let s = Setup()
        _ = await s.bridge.handle(name: "speakerLatency", body: ["id": "Speaker|built-in", "ms": 100])
        s.route.go(to: AudioRoute(output: bluetooth, systemLatencyMs: 112))
        _ = await s.bridge.handle(name: "speakerLatency", body: ["id": "BluetoothA2DPOutput|aa-bb", "ms": 230])
        s.route.go(to: AudioRoute(output: builtIn, systemLatencyMs: 10))
        s.route.go(to: AudioRoute(output: bluetooth, systemLatencyMs: 112))
        #expect(s.said.map { $0["body"]?["latencyMs"] } == [0, 100, 230])
        #expect(s.part.boot["speaker"]?["latencyMs"] == 230)
    }

    @Test func 同一種喇叭_uid變了_當新喇叭從0開始() async {
        let s = Setup()
        s.route.go(to: AudioRoute(output: bluetooth, systemLatencyMs: 112))
        _ = await s.bridge.handle(name: "speakerLatency", body: ["id": "BluetoothA2DPOutput|aa-bb", "ms": 100])
        let renamed = AudioOutput(portType: "BluetoothA2DPOutput", uid: "cc-dd", name: "練習場喇叭")
        s.route.go(to: AudioRoute(output: renamed, systemLatencyMs: 112))
        #expect(s.said.last?["body"]?["latencyMs"] == 0)
        #expect(s.said.last?["body"]?["id"] == "BluetoothA2DPOutput|cc-dd")
    }

    @Test func 兩個數字分開存_關掉再開記得延遲校正_系統說的照現在讀的() async throws {
        let url = emptyFolder().appendingPathComponent("speaker-latency.json")
        let first = Setup(latencies: SpeakerLatencies(url: url))
        _ = await first.bridge.handle(name: "speakerLatency", body: ["id": "Speaker|built-in", "ms": 100])

        let again = Setup(latencies: SpeakerLatencies(url: url))
        again.route.route = AudioRoute(output: builtIn, systemLatencyMs: 25)
        #expect(again.part.boot == ["speaker": ["id": "Speaker|built-in", "name": "iPhone 喇叭", "systemLatencyMs": 25, "latencyMs": 100]])
        // 存的檔只有延遲校正
        let saved = try JSONDecoder().decode([String: Double].self, from: Data(contentsOf: url))
        #expect(saved == ["Speaker|built-in": 100])
    }

    @Test func 系統說2000毫秒_照給不變0() {
        let s = Setup()
        s.route.go(to: AudioRoute(output: AudioOutput(portType: "AirPlay", uid: "tv", name: "客廳"), systemLatencyMs: 2000))
        #expect(s.said.last?["body"]?["systemLatencyMs"] == 2000)
    }

    @Test func 延遲校正超過1000_不收_原本的不動() async {
        let s = Setup()
        _ = await s.bridge.handle(name: "speakerLatency", body: ["id": "Speaker|built-in", "ms": 100])
        #expect(await s.bridge.handle(name: "speakerLatency", body: ["id": "Speaker|built-in", "ms": -1001]) == .error("failed"))
        #expect(await s.bridge.handle(name: "speakerLatency", body: ["id": "Speaker|built-in"]) == .error("failed"))
        #expect(s.part.boot["speaker"]?["latencyMs"] == 100)
    }

    @Test func 藍牙和耳機斷線才叫網頁停_AirPlay和一般換喇叭不停() {
        let s = Setup()
        let wired = AudioOutput(portType: "Headphones", uid: "wired", name: "耳機")
        let airPlay = AudioOutput(portType: "AirPlay", uid: "tv", name: "客廳")
        let home = AudioRoute(output: builtIn, systemLatencyMs: 10)
        for output in [bluetooth, wired, airPlay] {
            s.route.go(to: AudioRoute(output: output, systemLatencyMs: 50))
            s.route.go(to: home, oldDeviceUnavailable: true)
        }
        s.route.go(to: AudioRoute(output: bluetooth, systemLatencyMs: 50))
        s.route.go(to: home)
        let stops = s.said.map { $0["body"]?["stop"] }
        #expect(stops == [false, true, false, true, false, false, false, false])
    }

    /// AVAudioSession.Port.bluetoothLE 的 rawValue 是 "BluetoothLE"（iOS 27.2 模擬器上印出來的，codex 審查）。
    @Test func 藍牙LE斷線也叫網頁停() {
        let s = Setup()
        s.route.go(to: AudioRoute(output: AudioOutput(portType: "BluetoothLE", uid: "le", name: "耳機"), systemLatencyMs: 50))
        s.route.go(to: AudioRoute(output: builtIn, systemLatencyMs: 10), oldDeviceUnavailable: true)
        #expect(s.said.last?["body"]?["stop"] == true)
    }

    @Test func 開發版多塞一個記號_上架版沒有() {
        #expect(Setup(debug: true).part.boot["speakerDebug"] == true)
        #expect(Setup().part.boot["speakerDebug"] == nil)
    }
}
