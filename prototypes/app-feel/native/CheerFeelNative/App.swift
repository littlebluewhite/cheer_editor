// 小樣（#300，比完就丟）：(A) 原生畫面。只有比手感要的那幾樣：場地和 20 個人、播放、每拍閃一下、
// iPad 橫拿先選中再拖、從「檔案」App／分享選單打開流程檔、打開就回上次那支。不是完整的編輯器。
import SwiftUI
import UIKit

@main struct CheerFeelNativeApp: App {
    var body: some Scene {
        WindowGroup {
            Screen().ignoresSafeArea().onOpenURL { FloorController.shared.open($0) }
        }
    }
}

struct Screen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> FloorController { FloorController.shared }
    func updateUIViewController(_ vc: FloorController, context: Context) {}
}

final class FloorController: UIViewController {
    static let shared = FloorController()
    private let core = Core()
    private let player = Player()
    private let floor = FloorView()
    private let hud = UILabel()
    private let flash = UIView()
    private let playButton = UIButton(type: .system)
    private let fixButton = UIButton(type: .system)
    private let slider = UISlider()
    private let timeLabel = UILabel()
    private var link: CADisplayLink?
    private var loaded = false
    private var sec = 0.0
    private var total = 180.0
    private var bpm = 120.0
    private let launchedAt = processStart()
    private var launchMs: Double?
    // 量測
    private var frames = 0, late = 0.0, worst = 0.0, lastStamp = 0.0, since = 0.0, coreMs = 0.0, coreCalls = 0
    private var shown = (fps: 0, late: 0.0, worst: 0.0, core: 0.0)
    private var stepMs: Double?
    private var stepKind = ""
    private var note = ""

    private let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("last")

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.09, green: 0.13, blue: 0.22, alpha: 1)
        hud.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        hud.textColor = .green
        hud.numberOfLines = 4
        flash.layer.cornerRadius = 8
        flash.backgroundColor = .darkGray
        playButton.setTitle("▶︎ 播放", for: .normal)
        playButton.titleLabel?.font = .boldSystemFont(ofSize: 20)
        playButton.addAction(UIAction { [weak self] _ in self?.togglePlay() }, for: .touchUpInside)
        fixButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            player.latencyFix.toggle()
            if player.playing { player.play(from: sec, clips: core.clips(sec)) }
            drawButtons()
        }, for: .touchUpInside)
        slider.addAction(UIAction { [weak self] _ in self?.scrub() }, for: .valueChanged)
        timeLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        timeLabel.textColor = .white
        floor.onMoved = { [weak self] id, x, y in self?.moved(id, x, y) }
        let bar = UIStackView(arrangedSubviews: [playButton, timeLabel, slider, fixButton])
        bar.spacing = 12
        bar.alignment = .center
        for v in [floor, hud, flash, bar] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            hud.topAnchor.constraint(equalTo: g.topAnchor, constant: 4),
            hud.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 8),
            hud.trailingAnchor.constraint(equalTo: flash.leadingAnchor, constant: -8),
            flash.topAnchor.constraint(equalTo: g.topAnchor, constant: 4),
            flash.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -8),
            flash.widthAnchor.constraint(equalToConstant: 56), flash.heightAnchor.constraint(equalToConstant: 36),
            floor.topAnchor.constraint(equalTo: flash.bottomAnchor, constant: 6),
            floor.leadingAnchor.constraint(equalTo: g.leadingAnchor),
            floor.trailingAnchor.constraint(equalTo: g.trailingAnchor),
            floor.bottomAnchor.constraint(equalTo: bar.topAnchor, constant: -6),
            bar.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            bar.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            bar.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -8),
            bar.heightAnchor.constraint(equalToConstant: 44),
        ])
        drawButtons()
        player.onRestart = { [weak self] in
            guard let self, player.playing else { return }
            player.play(from: sec, clips: core.clips(sec))
        }
        // 打開就回上次那支（存在 app 自己的資料夾）
        if let json = try? String(contentsOf: dir.appendingPathComponent("flow.json"), encoding: .utf8) {
            core.setFlow(json)
            startFlow()
        } else {
            note = "還沒有流程：從「檔案」App 或分享選單打開 app-feel-test.cheera"
        }
        if let u = pendingURL { pendingURL = nil; open(u) }
        // 自己檢查用：simctl launch ... -autoplay 從第 10 秒自動播
        if ProcessInfo.processInfo.arguments.contains("-autoplay") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.sec = 10; self?.togglePlay() }
        }
        let l = CADisplayLink(target: self, selector: #selector(tick))
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        l.add(to: .main, forMode: .common)
        link = l
    }

    /// 「檔案」App、分享選單傳來的流程檔：讀進來，存到 app 自己的資料夾
    private var pendingURL: URL?
    func open(_ url: URL) {
        // 還沒畫好畫面（點檔案把 app 叫起來）：等 viewDidLoad 再開
        guard isViewLoaded else { pendingURL = url; return }
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        note = "收到 \(url.lastPathComponent)"
        guard let data = try? Data(contentsOf: url), let audio = core.read(data) else {
            note = "打不開：\(core.error ?? "讀不到檔")"
            return
        }
        player.stop()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (id, file) in core.audioFiles() {
            try? audio[id]?.write(to: dir.appendingPathComponent(id + "." + (file as NSString).pathExtension))
        }
        try? core.flowJson().write(to: dir.appendingPathComponent("flow.json"), atomically: true, encoding: .utf8)
        sec = 0
        startFlow()
    }

    private func startFlow() {
        note = ""
        var urls: [String: URL] = [:]
        for (id, file) in core.audioFiles() { urls[id] = dir.appendingPathComponent(id + "." + (file as NSString).pathExtension) }
        player.load(urls)
        total = core.total()
        bpm = core.bpm()
        slider.maximumValue = Float(total)
        floor.setMembers(core.ids.count)
        loaded = true
        draw(force: true)
    }

    private func togglePlay() {
        guard loaded else { return }
        if player.playing { player.stop() } else { player.play(from: sec >= total - 0.05 ? 0 : sec, clips: core.clips(sec >= total - 0.05 ? 0 : sec)) }
        drawButtons()
    }

    private func scrub() {
        sec = Double(slider.value)
        if player.playing { player.play(from: sec, clips: core.clips(sec)) }
        draw(force: true)
    }

    private func moved(_ id: Int, _ x: Double, _ y: Double) {
        let t0 = CACurrentMediaTime()
        stepKind = core.move(sec: sec, id: core.ids[id], x: x, y: y)
        stepMs = (CACurrentMediaTime() - t0) * 1000
        try? core.flowJson().write(to: dir.appendingPathComponent("flow.json"), atomically: true, encoding: .utf8)
        draw(force: true)
    }

    private func drawButtons() {
        playButton.setTitle(player.playing ? "⏸ 暫停" : "▶︎ 播放", for: .normal)
        fixButton.setTitle("扣延遲:\(player.latencyFix ? "開" : "關")", for: .normal)
    }

    @objc private func tick(_ l: CADisplayLink) {
        // 一秒幾格、卡頓（比預期的 1.5 倍還久才算，卡的時間 = 多出來的）、最慢的一格
        let expect = l.targetTimestamp - l.timestamp
        if lastStamp > 0 {
            let d = l.timestamp - lastStamp
            frames += 1
            if d > expect * 1.5 { late += (d - expect) * 1000 }
            worst = max(worst, d * 1000)
        }
        lastStamp = l.timestamp
        if since == 0 { since = l.timestamp }
        if l.timestamp - since >= 1 {
            let s = l.timestamp - since
            shown = (Int((Double(frames) / s).rounded()), late / s, worst, coreCalls > 0 ? coreMs / Double(coreCalls) : 0)
            frames = 0; late = 0; worst = 0; coreMs = 0; coreCalls = 0; since = l.timestamp
            player.refreshLatency()
            drawHud()
        }
        guard loaded else { return }
        // 有流程後的第一格：當成「看到流程」
        if launchMs == nil { launchMs = Date().timeIntervalSince(launchedAt) * 1000; drawHud() }
        if player.playing, let a = player.audibleSec() {
            sec = min(a, total)
            if sec >= total { player.stop(); drawButtons() }
            draw(force: false)
        }
    }

    private func draw(force: Bool) {
        let t0 = CACurrentMediaTime()
        let p = core.positions(sec)
        coreMs += (CACurrentMediaTime() - t0) * 1000
        coreCalls += 1
        floor.place(p)
        floor.editable = !player.playing && traitCollection.userInterfaceIdiom == .pad && view.bounds.width > view.bounds.height
        if !slider.isTracking { slider.value = Float(sec) }
        let beat = sec * bpm / 60
        let n = Int(beat)
        let count = n % 8 + 1
        timeLabel.text = String(format: "%d:%04.1f  %d-%d", Int(sec) / 60, sec.truncatingRemainder(dividingBy: 60), n / 8 + 1, count)
        // 每拍一開始亮 0.1 拍（120 BPM 是 50 毫秒）；八拍的 1 紅色
        let on = player.playing && beat - Double(n) < 0.1
        flash.backgroundColor = on ? (count == 1 ? .systemRed : .white) : .darkGray
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if loaded { draw(force: true) }
    }

    private func drawHud() {
        var s = String(format: "%d格 卡%.1fms/s 慢%.0f 延遲%.0f/io%.0fms 核心%.2fms", shown.fps, shown.late, shown.worst,
                       player.outputLatency * 1000, player.ioBuffer * 1000, shown.core)
        if let m = stepMs { s += String(format: " 拖一步%.1fms(%@)", m, stepKind) }
        if let m = launchMs { s += String(format: "\n開到看到流程%.0fms", m) }
        if !note.isEmpty { s += "\n" + note }
        if let e = core.error { s += "\n核心錯誤：" + e }
        hud.text = s
    }
}

/// 場地和人：一個人一個 CALayer，每格直接設位置（關掉動畫）
final class FloorView: UIView {
    private let width = 9 * 1.8288, depth = 7 * 1.8288, margin = 1.0
    private var dots: [CALayer] = []
    private var last: [Double] = []
    private var selected: Int?
    private var dragging: (i: Int, dx: CGFloat, dy: CGFloat)?
    var editable = false
    var onMoved: ((Int, Double, Double) -> Void)?
    private let fieldLayer = CALayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(fieldLayer)
    }
    required init?(coder: NSCoder) { fatalError() }

    private var scale: CGFloat { min(bounds.width / (width + 2 * margin), bounds.height / (depth + 2 * margin)) }
    private func point(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: bounds.midX + CGFloat(x) * scale, y: bounds.midY + CGFloat(y) * scale)
    }
    private func meters(_ p: CGPoint) -> (Double, Double) {
        let r = { (v: Double) in (v * 1000).rounded() / 1000 }
        let x = min(max(Double((p.x - bounds.midX) / scale), -width / 2 - margin), width / 2 + margin)
        let y = min(max(Double((p.y - bounds.midY) / scale), -depth / 2 - margin), depth / 2 + margin)
        return (r(x), r(y))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        fieldLayer.sublayers?.forEach { $0.removeFromSuperlayer() }
        let cell = 1.8288 * scale
        let origin = point(-width / 2, -depth / 2)
        for i in 0..<9 {
            let s = CALayer()
            s.frame = CGRect(x: origin.x + CGFloat(i) * cell, y: origin.y, width: cell - 1, height: CGFloat(depth) * scale)
            s.backgroundColor = (i % 2 == 0 ? UIColor(red: 0.21, green: 0.44, blue: 0.78, alpha: 1) : UIColor(red: 0.18, green: 0.40, blue: 0.72, alpha: 1)).cgColor
            fieldLayer.addSublayer(s)
        }
        let r = max(11, cell * 0.28)
        for d in dots { d.bounds = CGRect(x: 0, y: 0, width: r * 2, height: r * 2); d.cornerRadius = r; (d.sublayers?.first as? CATextLayer)?.frame = CGRect(x: 0, y: r - 8, width: r * 2, height: 16) }
        if !last.isEmpty { place(last) }
    }

    func setMembers(_ n: Int) {
        dots.forEach { $0.removeFromSuperlayer() }
        dots = (0..<n).map { i in
            let d = CALayer()
            d.backgroundColor = (i % 4 == 0 ? UIColor.systemRed : UIColor.white).cgColor
            d.borderColor = UIColor.black.cgColor
            d.borderWidth = 1.5
            let t = CATextLayer()
            t.string = "\(i + 1)"
            t.fontSize = 13
            t.alignmentMode = .center
            t.foregroundColor = (i % 4 == 0 ? UIColor.white : UIColor.black).cgColor
            t.contentsScale = UIScreen.main.scale
            d.addSublayer(t)
            layer.addSublayer(d)
            return d
        }
        setNeedsLayout()
    }

    func place(_ p: [Double]) {
        last = p
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, d) in dots.enumerated() where i * 2 + 1 < p.count && dragging?.i != i {
            d.position = point(p[i * 2], p[i * 2 + 1])
        }
        CATransaction.commit()
    }

    private func hit(_ p: CGPoint) -> Int? {
        dots.indices.min { hypot(dots[$0].position.x - p.x, dots[$0].position.y - p.y) < hypot(dots[$1].position.x - p.x, dots[$1].position.y - p.y) }
            .flatMap { hypot(dots[$0].position.x - p.x, dots[$0].position.y - p.y) < 30 ? $0 : nil }
    }

    // 先選中才拖（ADR 0005）：點一下選人，按住選中的那個才拖得動
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard editable, let p = touches.first?.location(in: self) else { return }
        guard let i = hit(p) else { select(nil); return }
        if selected == i { dragging = (i, dots[i].position.x - p.x, dots[i].position.y - p.y) } else { select(i) }
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let d = dragging, let t = touches.first else { return }
        let p = (event?.coalescedTouches(for: t)?.last ?? t).location(in: self)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        dots[d.i].position = CGPoint(x: p.x + d.dx, y: p.y + d.dy)
        CATransaction.commit()
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let d = dragging else { return }
        dragging = nil
        let (x, y) = meters(dots[d.i].position)
        onMoved?(d.i, x, y)
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        dragging = nil
        place(last)
    }
    private func select(_ i: Int?) {
        if let s = selected { dots[s].borderColor = UIColor.black.cgColor; dots[s].borderWidth = 1.5 }
        selected = i
        if let i { dots[i].borderColor = UIColor.systemYellow.cgColor; dots[i].borderWidth = 4 }
    }
}

/// 這個 process 什麼時候開始的（量「點圖示到看到流程」）
private func processStart() -> Date {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    sysctl(&mib, 4, &info, &size, nil, 0)
    let t = info.kp_proc.p_un.__p_starttime
    return Date(timeIntervalSince1970: Double(t.tv_sec) + Double(t.tv_usec) / 1e6)
}
