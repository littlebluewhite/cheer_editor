// 喇叭和延遲（#388，規格 #360「音樂、拍子、延遲校正」，情境 bridge-scenarios/current/speaker.json）。
// 網頁認不出現在用哪個喇叭、也收不到換喇叭的通知，所以殼讀（App 裡是 AVAudioSession，App/Bridge/AppSpeaker.swift）：
// 一開始塞、換喇叭時說 speakerChanged，三樣一起給：哪個喇叭、系統說的延遲、這個喇叭的延遲校正。
// 兩個數字分開給、分開存：±1000 毫秒只管延遲校正；系統說的延遲每次照讀的給（AirPlay 報約 2 秒也照給），不存。
// 延遲校正每個喇叭各記一個，用 portType＋uid 認（Apple 沒保證 uid 不變：變了就當新喇叭，從 0 開始）。
// 藍牙喇叭、耳機斷線（舊的那個不見了）時 speakerChanged 帶 stop: true，網頁停止播放。AirPlay 不特別做。
import Foundation

/// 一個喇叭（AVAudioSessionPortDescription 的 portType、uid、portName）。
public struct AudioOutput: Equatable, Sendable {
    public let portType: String
    public let uid: String
    public let name: String

    public init(portType: String, uid: String, name: String) {
        self.portType = portType
        self.uid = uid
        self.name = name
    }

    /// 殼認喇叭的編號（網頁不拆，改延遲校正時帶回來）。
    public var id: String { "\(portType)|\(uid)" }

    /// 斷線就停的：藍牙喇叭、耳機、有線耳機（AVAudioSession.Port 的 rawValue）。AirPlay 不算。
    var stopsWhenGone: Bool {
        ["BluetoothA2DPOutput", "BluetoothLEOutput", "BluetoothHFP", "Headphones"].contains(portType)
    }
}

/// 現在接的喇叭和系統說的延遲（毫秒）。
public struct AudioRoute: Equatable, Sendable {
    public let output: AudioOutput
    public let systemLatencyMs: Double

    public init(output: AudioOutput, systemLatencyMs: Double) {
        self.output = output
        self.systemLatencyMs = systemLatencyMs
    }
}

/// 每個喇叭的延遲校正（喇叭的 id → 毫秒），存成一個 JSON 檔。App 裡是 Application Support/speaker-latency.json（會進 iCloud 備份）。
@MainActor
public final class SpeakerLatencies {
    public let url: URL
    private var values: [String: Double]

    /// 讀存著的那份；沒有、讀不懂就從空的開始（每個喇叭都是 0）。
    public init(url: URL) {
        self.url = url
        values = (try? JSONDecoder().decode([String: Double].self, from: Data(contentsOf: url))) ?? [:]
    }

    public static func inApplicationSupport() -> SpeakerLatencies {
        SpeakerLatencies(url: URL.applicationSupportDirectory.appendingPathComponent("speaker-latency.json"))
    }

    func ms(for id: String) -> Double { values[id] ?? 0 }

    func set(_ id: String, _ ms: Double) throws {
        var next = values
        next[id] = ms
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(next).write(to: url, options: .atomic)
        values = next
    }
}

struct BadSpeakerLatency: Error {}

@MainActor
public final class SpeakerPart: BridgePart {
    /// 延遲校正最多調幾毫秒（前後都是），跟網頁的 MAX_LATENCY_MS 一樣。
    static let maxLatencyMs: Double = 1000

    private let latencies: SpeakerLatencies
    private let outbox: ShellOutbox
    private let read: () -> AudioRoute
    private let debug: Bool

    /// read：現在接的喇叭和系統說的延遲。debug：開發版（多塞 speakerDebug，網頁顯示殼讀的和網頁讀的系統延遲）。
    public init(latencies: SpeakerLatencies, outbox: ShellOutbox, read: @escaping () -> AudioRoute, debug: Bool = false) {
        self.latencies = latencies
        self.outbox = outbox
        self.read = read
        self.debug = debug
    }

    public var feature: String? { "speaker" }
    public var messages: Set<String> { ["speakerLatency"] }
    /// 每次都照現在讀的（網頁重新載入時再塞一次）。
    public var boot: [String: JSONValue] {
        var out: [String: JSONValue] = ["speaker": .object(speaker(read()))]
        if debug { out["speakerDebug"] = true }
        return out
    }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        guard case .object(let o) = body, case .string(let id)? = o["id"], case .number(let ms)? = o["ms"],
              abs(ms) <= Self.maxLatencyMs else { throw BadSpeakerLatency() }
        try latencies.set(id, ms)
        return nil
    }

    /// 換喇叭了（App 裡是 routeChangeNotification）：previous 是換之前的喇叭；oldDeviceUnavailable：舊的那個不見了（拔掉、斷線）。
    public func routeChanged(previous: AudioOutput?, oldDeviceUnavailable: Bool) {
        var body = speaker(read())
        body["stop"] = .bool(oldDeviceUnavailable && previous?.stopsWhenGone == true)
        outbox.emit("speakerChanged", .object(body))
    }

    private func speaker(_ route: AudioRoute) -> [String: JSONValue] {
        [
            "id": .string(route.output.id),
            "name": .string(route.output.name),
            "systemLatencyMs": .number(route.systemLatencyMs),
            "latencyMs": .number(latencies.ms(for: route.output.id)),
        ]
    }
}
