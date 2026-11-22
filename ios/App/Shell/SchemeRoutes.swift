// app://local/ 上，不是送網頁檔的路（SchemeRoute）。一條一個檔，在這裡登記一行。
// 一張票一格，各改自己那一格（中間空一行，幾張票同時加也合得起來，ios/README.md）。

@MainActor
enum SchemeRoutes {
    static func all(_ context: ShellContext) -> [any SchemeRoute] {
        [
            // #377

            // #380

            // #393
        ]
    }
}
