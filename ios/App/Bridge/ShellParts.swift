// 橋上的每一塊（ShellCore 的 BridgePart）。一件事一個檔；在這裡登記一行，測試的 ScenarioParts.swift 也登記一行（換成假的）。
// 一張票一格，各改自己那一格（中間空一行，幾張票同時加也合得起來，ios/README.md）。
// 要主動跟網頁說話的傳 context.outbox；要網頁畫面的（列印、重新載入）用 context.webView。
import os
import ShellCore

@MainActor
enum ShellParts {
    static func all(_ context: ShellContext) -> [any BridgePart] {
        [
            ReadyPart(onReady: { Logger.shell.info("網頁說好了"); context.webUpdates.updater.webSaidReady() }),  // #393：換上新網頁後靠它判斷打不打得開
            // #376
            ScreenPart(onScreen: { ScreenFeelView.around(context.webView)?.kind = $0 }),

            // #377
            DraftsPart.inApp(outbox: context.outbox),

            // #378
            SettingsPart(file: .inApplicationSupport()),

            // #380
            SitePart(site: AppSite.current),

            // #381
            CloudRoomPart.inApp(outbox: context.outbox),

            // #382
            CloudMusicPart(),

            // #383
            OfflinePart(folder: .inApplicationSupport()),

            // #389
            NowPlayingPart.onLockScreen(context.outbox),

            // #391
            PrintPart(onPrint: { Printer.present(context.webView, from: $0) }),

            // #393
            context.webUpdates.part,
        ]
    }
}

extension Logger {
    static let shell = Logger(subsystem: "cheer-editor", category: "shell")
}
