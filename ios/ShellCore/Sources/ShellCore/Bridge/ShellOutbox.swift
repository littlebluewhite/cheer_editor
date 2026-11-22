// 殼主動跟網頁說的話（換喇叭、鎖定畫面按了播放…）：橋上的一塊從 init 拿到它，emit 一句。
// App 裡接到 WebShell.emit（網頁用 __cheerShell.on 收）；測試裡接到記下來的地方。
@MainActor
public final class ShellOutbox {
    /// 真的送出去的地方：App 建好網頁畫面後接上；還沒接上時說的話丟掉。
    public var deliver: ((String, JSONValue) -> Void)?

    public init(deliver: ((String, JSONValue) -> Void)? = nil) {
        self.deliver = deliver
    }

    public func emit(_ name: String, _ body: JSONValue = nil) {
        deliver?(name, body)
    }
}
