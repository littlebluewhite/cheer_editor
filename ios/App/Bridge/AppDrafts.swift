// 草稿存在殼裡（#377）：App 裡的那一塊。草稿放 Application Support/Drafts（會進 iCloud 備份）。
// - App 要切到背景（scene 不在前景了：滑到 App 切換器，接著可能被滑掉）：跟網頁說，網頁馬上存還沒進草稿的改動。
// - 存的時候跟系統要一點背景時間：切到背景那一下網頁才送來的草稿，寫完才讓系統暫停 App。
import ShellCore
import UIKit

extension DraftsPart {
    static func inApp(outbox: ShellOutbox, folder: DraftFolder = .inApplicationSupport()) -> DraftsPart {
        let part = DraftsPart(folder: folder, outbox: outbox, keepAlive: {
            let task = UIApplication.shared.beginBackgroundTask(withName: "存草稿")
            return { if task != .invalid { UIApplication.shared.endBackgroundTask(task) } }
        })
        // 一直聽到 App 結束（App 只建一次）
        _ = NotificationCenter.default.addObserver(forName: UIScene.willDeactivateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { part.appGoingAway() }
        }
        return part
    }
}
