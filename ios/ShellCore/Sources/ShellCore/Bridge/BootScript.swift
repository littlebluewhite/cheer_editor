// 殼在 document start 塞進網頁的 JS（Resources/bridge.js）：一開始塞的那份放進去，網頁從 window.__cheerShell 讀。
import Foundation

public enum BootScript {
    public static func source(boot: [String: JSONValue]) -> String {
        template.replacingOccurrences(of: "__BOOT__", with: JSONValue.object(boot).jsonString)
    }

    private static let template: String = {
        // 跟著套件一起的檔，讀不到是建置壞了
        let url = Bundle.module.url(forResource: "bridge", withExtension: "js")!
        return try! String(contentsOf: url, encoding: .utf8)
    }()
}
