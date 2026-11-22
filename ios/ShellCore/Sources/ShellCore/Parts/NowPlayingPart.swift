// 鎖定畫面的播放鍵（#389，情境 bridge-scenarios/current/nowPlaying.json）。
// 網頁說「現在播什麼」（流程的名字、在不在播；沒東西播是 null），殼交給 show 顯示在鎖定畫面、控制中心。
// 鎖定畫面、耳機按了播放、暫停：App 叫 press，殼跟網頁說 remote（command: play / pause），網頁自己播、停，再說一次現在播什麼。
// 只顯示名字，不給播了幾秒、總長：重複、慢速、跳來跳去時系統自己往下算的秒數會對不上。

/// 鎖定畫面上顯示的。
public struct NowPlaying: Equatable, Sendable {
    public let title: String
    public let playing: Bool

    public init(title: String, playing: Bool) {
        self.title = title
        self.playing = playing
    }
}

/// 鎖定畫面、控制中心、耳機上的鍵。
public enum LockScreenButton: Sendable {
    case play, pause, togglePlayPause
}

struct BadNowPlaying: Error {}

@MainActor
public final class NowPlayingPart: BridgePart {
    private let outbox: ShellOutbox
    private let show: (NowPlaying?) -> Void
    private var current: NowPlaying?

    /// show：顯示在鎖定畫面（nil 是收掉）。
    public init(outbox: ShellOutbox, show: @escaping (NowPlaying?) -> Void) {
        self.outbox = outbox
        self.show = show
    }

    public var feature: String? { "nowPlaying" }
    public var messages: Set<String> { ["nowPlaying"] }

    public func handle(name: String, body: JSONValue) async throws -> JSONValue {
        switch body {
        case .null:
            current = nil
        case .object(let o):
            guard case .string(let title)? = o["title"], case .bool(let playing)? = o["playing"] else { throw BadNowPlaying() }
            current = NowPlaying(title: title, playing: playing)
        default:
            throw BadNowPlaying()
        }
        show(current)
        return .null
    }

    /// 鎖定畫面按了鍵：叫網頁播或停。鎖定畫面沒東西時不叫，回 false。
    @discardableResult
    public func press(_ button: LockScreenButton) -> Bool {
        guard let current else { return false }
        let play = switch button {
        case .play: true
        case .pause: false
        case .togglePlayPause: !current.playing
        }
        outbox.emit("remote", ["command": play ? "play" : "pause"])
        return true
    }
}
