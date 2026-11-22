// 殼自己從網站更新包著的網頁（#393、ADR 0025）：抓網站的清單（/web-bundle.json，scripts/web-bundle.mjs），
// 跟現在開的那包不一樣就整包下載、每個檔比 SHA-256；說換才換（回到首頁、下次打開）；換上後 10 秒內網頁沒說「好了」或當掉就退回。
//
// - 比的是「跟網站上的一不一樣」，不比新舊：網站倒回舊的也跟著換回去。
// - App 裡附的那包（Web.bundle）永遠留著當退路，不刪；下載的放 root/bundles/<代號>/。
// - 只從 site 抓：清單裡的路徑一定要是這個網站底下的相對路徑，不然整包不收。
// - 清單的 minShellBuild（要第幾版以上的殼）這裡不看，#394 接。
import CryptoKit
import Foundation

public struct WebBundleManifest: Decodable, Sendable {
    public struct File: Decodable, Sendable {
        public let path: String
        public let size: Int
        public let sha256: String
    }
    public let id: String
    public let files: [File]
    public let minShellBuild: Int?

    public static let fileName = "web-bundle.json"
}

@MainActor
public final class WebUpdater {
    public enum CheckResult: Equatable, Sendable {
        /// 跟網站上的一樣（或網站倒回現在開的這包）。
        case same
        /// 網站上的那包下載好了（或本來就在），說換就換。
        case downloaded(String)
        /// 有一個檔對不上、下載到一半斷了：整包丟掉，下次再抓。
        case discarded
        /// 網站上的是換上後打不開的那包：不再抓，網站換了才再抓。
        case bad(String)
        /// 已經在檢查了（打開和回到前景同時來）。
        case busy
        /// 清單抓不到、看不懂、不是這個網站的檔。
        case failed
    }

    /// 存在 root/state.json 的。
    struct State: Codable, Equatable {
        /// 現在開的那包（下載的）；nil 是 App 裡附的那包。
        var active: String?
        /// 下載好了、等著換的那包（可能就是附的那包的代號）。
        var staged: String?
        /// 換上了，還沒說「好了」。
        var trial: Bool = false
        /// 還沒說「好了」時，打不開要退回的那包（nil 是附的那包）。
        var previous: String?
        /// 打不開的（只留最近幾包）。
        var bad: [String] = []
    }

    private let site: URL
    private let root: URL
    private let fetch: (URL) async throws -> Data
    private let trialTimeout: Duration
    private let rolledBack: @MainActor () -> Void
    private let bundledID: String?
    private var state: State
    private var checking = false
    private var timer: Task<Void, Never>?
    private let fm = FileManager.default

    /// - site：自己的網站（上架版寫死）。root：放下載的網頁的資料夾。bundled：App 裡附的那包（Web.bundle）。
    /// - rolledBack：退回了，App 重新載入網頁。
    public init(site: URL, root: URL, bundled: URL, fetch: @escaping (URL) async throws -> Data,
                trialTimeout: Duration = .seconds(10), rolledBack: @escaping @MainActor () -> Void) {
        self.site = site
        self.root = root
        self.fetch = fetch
        self.trialTimeout = trialTimeout
        self.rolledBack = rolledBack
        bundledID = (try? Data(contentsOf: bundled.appendingPathComponent(WebBundleManifest.fileName)))
            .flatMap { try? JSONDecoder().decode(WebBundleManifest.self, from: $0) }?.id
        state = (try? Data(contentsOf: root.appendingPathComponent("state.json")))
            .flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()
    }

    /// 網頁要從哪個資料夾送；nil 是 App 裡附的那包。
    public var servingRoot: URL? { state.active.map(folder) }

    /// App 打開時（第一次載入網頁之前）叫：下載好的換上；上次換上還沒說「好了」就被關掉的，再等一次。
    public func launch() {
        try? fm.removeItem(at: staging)
        if let active = state.active, !fm.fileExists(atPath: folder(active).path) {
            state.active = nil; state.trial = false
        }
        if state.staged != nil { _ = useNew() }
        else if state.trial { startTimer() }
        save()
    }

    /// 去網站看有沒有不一樣的；不一樣就整包下載。打開、回到前景時叫。
    public func check() async -> CheckResult {
        guard !checking else { return .busy }
        checking = true
        defer { checking = false }
        guard let manifest = await manifest() else { return .failed }
        let id = manifest.id
        if id == (state.active ?? bundledID) {
            if state.staged != nil { state.staged = nil; save(); prune() }
            return .same
        }
        if id == state.staged { return .downloaded(id) }
        if state.bad.contains(id) { return .bad(id) }
        if id != bundledID, !fm.fileExists(atPath: folder(id).path) {
            guard await download(manifest) else { return .discarded }
        }
        state.staged = id
        save()
        prune()
        return .downloaded(id)
    }

    /// 換上下載好的那包（App 接著重新載入網頁）。沒有下載好的回 false。
    public func useNew() -> Bool {
        guard let staged = state.staged else { return false }
        state.staged = nil
        if staged == bundledID {
            // 附的那包是退路，不用試
            state.active = nil; state.trial = false; state.previous = nil
        } else {
            if !state.trial { state.previous = state.active }
            state.active = staged
            state.trial = true
            startTimer()
        }
        save()
        prune()
        return true
    }

    /// 網頁說「好了」：換上的這包打得開，留著。
    public func webSaidReady() {
        guard state.trial else { return }
        timer?.cancel()
        state.trial = false
        state.previous = nil
        save()
        prune()
    }

    /// 網頁的行程當掉：換上後還沒說「好了」就退回（回 true，App 重新載入）。
    public func webCrashed() -> Bool {
        guard state.trial else { return false }
        rollBack()
        return true
    }

    // MARK: - 裡面

    private var staging: URL { root.appendingPathComponent("staging") }
    private func folder(_ id: String) -> URL { root.appendingPathComponent("bundles").appendingPathComponent(id) }

    private func startTimer() {
        timer?.cancel()
        let id = state.active
        timer = Task { [weak self, trialTimeout] in
            try? await Task.sleep(for: trialTimeout)
            guard !Task.isCancelled, let self, self.state.trial, self.state.active == id else { return }
            self.rollBack()
        }
    }

    private func rollBack() {
        timer?.cancel()
        if let active = state.active { state.bad = Array((state.bad + [active]).suffix(10)) }
        state.active = state.previous.flatMap { fm.fileExists(atPath: folder($0).path) ? $0 : nil }
        state.previous = nil
        state.trial = false
        save()
        prune()
        rolledBack()
    }

    private func manifest() async -> WebBundleManifest? {
        guard let data = try? await fetch(site.appendingPathComponent(WebBundleManifest.fileName)),
              let manifest = try? JSONDecoder().decode(WebBundleManifest.self, from: data),
              Self.isID(manifest.id),
              manifest.files.allSatisfy({ fileURL($0.path) != nil && Self.isID($0.sha256) })
        else { return nil }
        return manifest
    }

    /// 下載到 staging，每個檔比大小和 SHA-256；都對了才搬到 bundles/<代號>。
    private func download(_ manifest: WebBundleManifest) async -> Bool {
        let dir = staging.appendingPathComponent(manifest.id)
        try? fm.removeItem(at: dir)
        do {
            for file in manifest.files {
                guard let url = fileURL(file.path) else { throw URLError(.badURL) }
                let data = try await fetch(url)
                guard data.count == file.size, Self.sha256(data) == file.sha256 else { throw URLError(.cannotDecodeContentData) }
                let to = dir.appendingPathComponent(file.path)
                try fm.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: to)
            }
            try fm.createDirectory(at: folder(manifest.id).deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: dir, to: folder(manifest.id))
            return true
        } catch {
            try? fm.removeItem(at: dir)
            return false
        }
    }

    /// 清單裡的路徑 → 這個網站上的網址。不是這個網站底下的相對路徑就 nil。
    private func fileURL(_ path: String) -> URL? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.isEmpty, !path.contains("\\"), !path.contains(":"),
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        let url = parts.reduce(site) { $0.appendingPathComponent(String($1)) }
        guard url.scheme == site.scheme, url.host == site.host, url.port == site.port else { return nil }
        return url
    }

    private func save() {
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        try? JSONEncoder().encode(state).write(to: root.appendingPathComponent("state.json"), options: .atomic)
    }

    /// 只留現在開的、等著換的、退路那包。
    private func prune() {
        let keep = Set([state.active, state.staged, state.previous].compactMap { $0 })
        let bundles = root.appendingPathComponent("bundles")
        for name in (try? fm.contentsOfDirectory(atPath: bundles.path)) ?? [] where !keep.contains(name) {
            try? fm.removeItem(at: bundles.appendingPathComponent(name))
        }
    }

    static func isID(_ s: String) -> Bool {
        s.count == 64 && s.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
