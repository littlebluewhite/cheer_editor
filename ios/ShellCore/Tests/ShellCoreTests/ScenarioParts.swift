// 情境測試用的殼：真的每一塊，要碰畫面、系統的換成假的。App 那邊照樣登記在 App/Bridge/ShellParts.swift。
// 一張票一格，各改自己那一格（中間空一行，幾張票同時加也合得起來，ios/README.md）：
//   - 假的東西放成 ScenarioShell 的屬性（例：let route = FakeAudioRoute()）
//   - parts 登記那一塊（用 outbox 和假的東西建）
//   - 情境裡有殼主動說的話（from: shell），在 triggers 登記「怎麼讓殼說這句」，key 是那句話的名字
import ShellCore

@MainActor
final class ScenarioShell {
    let outbox = ShellOutbox()
    private(set) var parts: [any BridgePart] = []
    private(set) var triggers: [String: @MainActor () async -> Void] = [:]

    // 假的東西
    // #376

    // #377
    let drafts = DraftFolder.forScenario()

    // #380

    // #389
    lazy var nowPlaying = NowPlayingPart(outbox: outbox, show: { _ in })

    // #391

    // #393

    /// 測試自己建的殼（ScenarioTests 測情境的跑法用）。
    init(parts: [any BridgePart], triggers: [String: @MainActor () async -> Void]) {
        self.parts = parts
        self.triggers = triggers
    }

    /// 真的每一塊。
    init() {
        parts = [
            ReadyPart(onReady: {}),
            // #376

            // #377
            DraftsPart(folder: drafts, outbox: outbox),

            // #380

            // #389
            nowPlaying,

            // #391

            // #393
        ]
        let triggerList: [(String, @MainActor () async -> Void)] = [
            // 例：("routeChanged", { self.route.change(to: .bluetooth) }),
            // #376

            // #377
            ("background", { DraftsPart(folder: self.drafts, outbox: self.outbox).appGoingAway() }),

            // #380

            // #389
            ("remote", { self.nowPlaying.press(.togglePlayPause) }),

            // #391

            // #393
        ]
        triggers = Dictionary(uniqueKeysWithValues: triggerList)
    }
}
