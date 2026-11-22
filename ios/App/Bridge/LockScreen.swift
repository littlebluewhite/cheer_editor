// 鎖定畫面、控制中心的播放鍵（#389）：NowPlayingPart（ShellCore）的規則接上系統的 MPNowPlayingInfoCenter、MPRemoteCommandCenter。
// 只顯示流程的名字（MPMediaItemPropertyTitle）和在不在播（播放速度 1 或 0），不給播了幾秒、總長（NowPlayingPart.swift 寫了為什麼）。
// 鎖螢幕繼續播靠 Info.plist 的 UIBackgroundModes（audio）和網頁的 navigator.audioSession.type = 'playback'。
import MediaPlayer
import ShellCore

extension NowPlayingPart {
    /// 真的鎖定畫面：顯示交給 MPNowPlayingInfoCenter，按鍵從 MPRemoteCommandCenter 進來叫 press。
    static func onLockScreen(_ outbox: ShellOutbox) -> NowPlayingPart {
        let part = NowPlayingPart(outbox: outbox, show: { shown in
            MPNowPlayingInfoCenter.default().nowPlayingInfo = shown.map {
                [MPMediaItemPropertyTitle: $0.title, MPNowPlayingInfoPropertyPlaybackRate: $0.playing ? 1.0 : 0.0]
            }
        })
        let center = MPRemoteCommandCenter.shared()
        let buttons: [(MPRemoteCommand, LockScreenButton)] = [
            (center.playCommand, .play), (center.pauseCommand, .pause), (center.togglePlayPauseCommand, .togglePlayPause),
        ]
        for (command, button) in buttons {
            // 橋重建（網頁換了一包）時不要疊兩個
            command.removeTarget(nil)
            command.isEnabled = true
            command.addTarget { _ in
                MainActor.assumeIsolated { part.press(button) } ? .success : .noActionableNowPlayingItem
            }
        }
        return part
    }
}
