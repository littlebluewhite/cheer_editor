// 殼的手感（#376，照 #336 的結論）：包著的網頁用起來不像網頁。App 那邊照這裡調 WKWebView（App/Shell/ScreenFeelView.swift）。
//
// - 邊邊（瀏海、底下的橫條）：網頁放在不會被擋的範圍裡，邊邊塗網頁的底色 paper。
// - 回彈：編輯畫面整頁不回彈，會捲的頁照樣回彈（網頁用 ScreenPart 說現在是哪一種）。
// - 字跟著系統的「文字大小」：整頁照比例放大，有上限，見 zoom。放大的方法見 viewport。
import Foundation

public enum ScreenFeel {
    /// 網頁的底色（src/app.css 的 --paper；有測試對）。網頁沒有深色模式，邊邊也一直是這個顏色。
    public static let paper = SRGB(0xeceff5)

    public static func bounces(_ kind: ScreenKind) -> Bool {
        kind == .page
    }

    /// 系統「文字大小」是預設時，內文（body 樣式）的字級（點）。比這大多少，整頁就放大多少。
    public static let defaultBodySize = 17.0
    /// 編輯畫面至少要這麼寬、這麼高（CSS px；src/lib/editor-layout.ts 的 EDIT_MIN_W_PX、EDIT_MIN_H_PX，有測試對）。
    public static let editMinWidth = 1024.0
    public static let editMinHeight = 600.0
    /// 窄螢幕（手機、拿直的 iPad）的網頁，短的那邊至少要這麼多 CSS px：再窄，登入、帳號、檢視畫面的小窗就超出畫面（#376 開工量的）。
    public static let narrowMinSide = 320.0

    /// 整頁放大幾倍。bodySize：系統現在的內文字級（點）；width、height：網頁畫面的大小（點）。
    ///
    /// 放大等於網頁看到的畫面變小（CSS 寬高 = 點 ÷ 倍數），所以上限照畫面算，不是固定的數字：
    /// - 能編輯的畫面（橫拿的 iPad）：放大到剛好還有 1024×600 就停。再大就變成窄螢幕，首頁不能新建、編輯畫面只能看。
    ///   iPad mini 橫拿只能到 1.10 倍，13 吋 iPad Pro 1.34 倍。
    /// - 窄螢幕：放大到短的那邊剩 320 就停（iPhone SE 1.17 倍、iPhone 17 1.25 倍）。
    /// 上限取到小數兩位、捨去，放大後一定還夠。系統的字調小時照樣縮小；上限不會小於 1（本來就不夠大的畫面不放大）。
    public static func zoom(bodySize: Double, width: Double, height: Double) -> Double {
        let want = bodySize / defaultBodySize
        let editable = width >= editMinWidth && height >= editMinHeight
        let fit = editable
            ? min(width / editMinWidth, height / editMinHeight)
            : min(width, height) / narrowMinSide
        let cap = max(1, (fit * 100).rounded(.down) / 100)
        return min(want, cap)
    }

    /// 放大 zoom 倍時網頁的 viewport（殼改網頁 <meta name="viewport"> 的 content）。width：網頁畫面的寬（點）。
    ///
    /// 不用 WKWebView 的 pageZoom：#336 原本定用它，但 #376 開工在 iOS 27.2 模擬器上量到，網頁有 width=device-width 時
    /// pageZoom 只讓 innerWidth、媒體查詢變小，版面還是照原本的寬排，字變大了右邊整排跑出畫面。
    /// 寫明寬度和 initial-scale 才會照放大後的寬重排（body、scrollWidth、innerWidth 都是 寬 ÷ 倍數）。
    public static func viewport(zoom: Double, width: Double) -> String {
        if zoom == 1 { return "width=device-width, initial-scale=1" }
        return "width=\(Int((width / zoom).rounded(.down))), initial-scale=\(zoom)"
    }
}

/// sRGB 顏色（ShellCore 不碰 UIKit；App 換成 UIColor）。
public struct SRGB: Equatable, Sendable {
    public let red: Double, green: Double, blue: Double
    public let hex: String

    public init(_ rgb: Int) {
        red = Double((rgb >> 16) & 0xff) / 255
        green = Double((rgb >> 8) & 0xff) / 255
        blue = Double(rgb & 0xff) / 255
        hex = String(format: "#%06x", rgb)
    }
}
