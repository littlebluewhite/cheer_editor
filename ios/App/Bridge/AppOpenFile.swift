// 在 App 裡打開流程檔（#384，ADR 0024）：App 這邊。規則在 ShellCore 的 OpenFilePart。
// - 「檔案」點 .cheer、分享選單把 .zip、.cheer 交給 App：SceneDelegate 收到網址，交給 OpenFilePart（handOver）。
//   型別宣告在 Info.plist：.cheer 是自己的型別（conform 到 public.data、public.content，不 conform 到 public.zip-archive），zip 是「也能開」（分享選單用）。
//   LSSupportsOpeningDocumentsInPlace：「檔案」給的是原檔（存檔蓋回它，#385 的 SaveFilePart），分享選單給的是副本。
// - 「開啟流程檔」：叫出系統的選檔畫面，只選得到 .cheer、.zip，原地打開（asCopy: false），不複製一份。
import ShellCore
import UIKit
import UniformTypeIdentifiers

extension UTType {
    /// 流程檔 .cheer（Info.plist 的 UTExportedTypeDeclarations）。
    static let cheerFlow = UTType(exportedAs: "com.littlebluewhite.cheereditor.flow")
}

extension OpenFilePart {
    /// App 用的：選檔畫面蓋在網頁畫面上；建好了記在 context，SceneDelegate 收到的檔交給它。
    static func inApp(_ context: ShellContext) -> OpenFilePart {
        let part = OpenFilePart(outbox: context.outbox, pick: { await FlowFilePicker.pick(over: context.webView) })
        context.openFile = part
        return part
    }
}

/// 系統的選檔畫面：一次只開一個。選了回網址，取消回 nil。
@MainActor
final class FlowFilePicker: NSObject, UIDocumentPickerDelegate {
    /// 開著的那個（選檔畫面的 delegate 是弱參照，要有人抓著）。
    private static var showing: FlowFilePicker?
    private var done: CheckedContinuation<URL?, Never>?

    static func pick(over view: UIView?) async -> URL? {
        guard showing == nil, var top = view?.window?.rootViewController else { return nil }
        while let above = top.presentedViewController { top = above }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.cheerFlow, .zip], asCopy: false)
        let me = FlowFilePicker()
        picker.delegate = me
        showing = me
        defer { showing = nil }
        return await withCheckedContinuation { continuation in
            me.done = continuation
            top.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(urls.first)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(nil)
    }

    private func finish(_ url: URL?) {
        done?.resume(returning: url)
        done = nil
    }
}
