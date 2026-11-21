// 小樣（#300，比完就丟）：AVAudioEngine 播音樂，播放頭用聲音的 sample 位置算。
import AVFAudio
import Foundation

final class Player {
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private var files: [String: AVAudioFile] = [:]
    private var fromSec = 0.0
    private(set) var playing = false
    /// 扣掉輸出延遲（AVAudioSession.outputLatency）：畫面晚一點，對準喇叭真的出聲
    var latencyFix = UserDefaults.standard.object(forKey: "latencyFix") as? Bool ?? true {
        didSet { UserDefaults.standard.set(latencyFix, forKey: "latencyFix") }
    }
    private(set) var outputLatency = 0.0
    private(set) var ioBuffer = 0.0
    var onRestart: (() -> Void)?

    init() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback)
        try? s.setActive(true)
        engine.attach(node)
        refreshLatency()
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshLatency()
        }
        // 換喇叭（接藍牙）時引擎會停：照現在的位置重播
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.refreshLatency()
            self?.onRestart?()
        }
    }

    func refreshLatency() {
        let s = AVAudioSession.sharedInstance()
        outputLatency = s.outputLatency
        ioBuffer = s.ioBufferDuration
    }

    /// 音樂檔放在 app 自己的資料夾（Application Support）
    func load(_ urls: [String: URL]) {
        files = urls.compactMapValues { try? AVAudioFile(forReading: $0) }
        if let f = files.values.first {
            engine.disconnectNodeOutput(node)
            engine.connect(node, to: engine.mainMixerNode, format: f.processingFormat)
        }
    }

    /// 從流程第 sec 秒播，照流程核心的 playbackPlan 排每一段音樂
    func play(from sec: Double, clips: [[String: Any]]) {
        stop()
        guard let any = files.values.first else { return }
        let rate = any.processingFormat.sampleRate
        if !engine.isRunning { try? engine.start() }
        for c in clips {
            guard let f = files[c["audioId"] as! String] else { continue }
            let at = max(0, (c["sec"] as! Double) - sec)
            let start = AVAudioFramePosition((c["fileSec"] as! Double) * f.processingFormat.sampleRate)
            let count = AVAudioFrameCount((c["durationSec"] as! Double) * f.processingFormat.sampleRate)
            guard count > 0 else { continue }
            node.scheduleSegment(f, startingFrame: start, frameCount: count, at: AVAudioTime(sampleTime: AVAudioFramePosition(at * rate), atRate: rate))
        }
        fromSec = sec
        node.play()
        playing = true
        refreshLatency()
    }

    func stop() {
        node.stop()
        playing = false
    }

    /// 喇叭現在播到流程第幾秒
    func audibleSec() -> Double? {
        guard playing, let t = node.lastRenderTime, t.isSampleTimeValid, let p = node.playerTime(forNodeTime: t) else { return nil }
        var sec = Double(p.sampleTime) / p.sampleRate
        if t.isHostTimeValid {
            sec += AVAudioTime.seconds(forHostTime: mach_absolute_time()) - AVAudioTime.seconds(forHostTime: t.hostTime)
        }
        if latencyFix { sec -= outputLatency }
        return fromSec + max(0, sec)
    }
}
