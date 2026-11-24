// 喇叭和延遲（#388）：App 裡的那一塊。規則在 ShellCore 的 SpeakerPart；這裡只接系統：
// - 現在接的喇叭：AVAudioSession.currentRoute.outputs 的第一個（portType、uid、portName）；系統說的延遲：outputLatency（秒，換成毫秒）。
// - 換喇叭：routeChangeNotification（不在主執行緒發，丟回主執行緒）；換之前的喇叭從 userInfo 的 previousRoute 拿，
//   reason 是 oldDeviceUnavailable 就是舊的那個不見了。
// 只讀，不改 audio session 的種類、不 setActive：網頁的 navigator.audioSession 管（#387 試來電就是這樣試的）。
import AVFoundation
import ShellCore

extension SpeakerPart {
    /// 橋重建（網頁換了一包）時換掉舊的那個聽的人，不要疊兩個。
    @MainActor private static var listening: NSObjectProtocol?

    @MainActor
    static func inApp(outbox: ShellOutbox, latencies: SpeakerLatencies = .inApplicationSupport()) -> SpeakerPart {
        #if DEBUG
        let debug = true
        #else
        let debug = false
        #endif
        let part = SpeakerPart(latencies: latencies, outbox: outbox, read: AppAudioRoute.read, debug: debug)
        if let listening { NotificationCenter.default.removeObserver(listening) }
        listening = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { note in
            let previous = (note.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription)
                .flatMap(AppAudioRoute.output)
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
                .flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
            MainActor.assumeIsolated {
                part.routeChanged(previous: previous, oldDeviceUnavailable: reason == .oldDeviceUnavailable)
            }
        }
        return part
    }
}

enum AppAudioRoute {
    static func read() -> AudioRoute {
        let session = AVAudioSession.sharedInstance()
        let output = output(session.currentRoute) ?? AudioOutput(portType: "", uid: "", name: "")
        return AudioRoute(output: output, systemLatencyMs: session.outputLatency * 1000)
    }

    static func output(_ route: AVAudioSessionRouteDescription) -> AudioOutput? {
        route.outputs.first.map { AudioOutput(portType: $0.portType.rawValue, uid: $0.uid, name: $0.portName) }
    }
}
