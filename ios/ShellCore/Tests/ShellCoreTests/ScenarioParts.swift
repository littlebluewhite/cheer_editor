// 情境測試用的殼：真的每一塊，要碰畫面、系統的換成假的。App 那邊照樣登記在 App/Sources/Bridge/ShellParts.swift。
// 一張票一格，各改自己那一格（中間空一行，幾張票同時加也合得起來，ios/README.md）。
import ShellCore

@MainActor
enum ScenarioParts {
    static func all() -> [any BridgePart] {
        [
            ReadyPart(onReady: {}),
            // #376

            // #377

            // #380

            // #389

            // #391

            // #393
        ]
    }
}
