// 存檔蓋回原本的檔、「傳給別人」（#385）：App 這邊。規則在 ShellCore 的 SaveFilePart。
// - 問存到哪：先把位元組寫成暫存資料夾裡的「流程名.cheer」，叫出系統的存檔畫面（UIDocumentPickerViewController forExporting，asCopy: false），
//   系統把它搬到選的地方，回那裡的網址（security-scoped，記成書籤，下次蓋回去）。按取消回 nil。
// - 傳給別人：暫存資料夾裡寫「流程名.zip」，叫出分享選單（UIActivityViewController）。iPad 從按的那顆鈕跳出來。
import ShellCore
import UIKit

extension SaveFilePart {
    static func inApp(_ context: ShellContext) -> SaveFilePart {
        SaveFilePart(
            askWhere: { name, bytes in await FlowFileExporter.askWhere(name, bytes, over: context.webView) },
            share: { name, bytes, button in await FlowFileSharer.share(name, bytes, from: button, over: context.webView) }
        )
    }
}

/// 暫存資料夾裡寫一個叫 name 的檔（每次一個新的資料夾，名字照網頁給的）。
@MainActor
private func temporaryFile(_ name: String, _ bytes: Data) -> URL? {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("flow-\(UUID().uuidString)", isDirectory: true)
    let url = folder.appendingPathComponent(name)
    do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try bytes.write(to: url)
        return url
    } catch {
        return nil
    }
}

/// 最上面的畫面（選檔、分享選單蓋在它上面）。
@MainActor
private func topController(_ view: UIView?) -> UIViewController? {
    guard var top = view?.window?.rootViewController else { return nil }
    while let above = top.presentedViewController { top = above }
    return top
}

/// 系統的存檔畫面：一次只開一個。存好回那裡的網址，取消回 nil。
@MainActor
final class FlowFileExporter: NSObject, UIDocumentPickerDelegate {
    private static var showing: FlowFileExporter?
    private var done: CheckedContinuation<URL?, Never>?

    static func askWhere(_ name: String, _ bytes: Data, over view: UIView?) async -> URL? {
        guard showing == nil, let top = topController(view), let file = temporaryFile(name, bytes) else { return nil }
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: false)
        let me = FlowFileExporter()
        picker.delegate = me
        showing = me
        defer { showing = nil }
        return await withCheckedContinuation { continuation in
            me.done = continuation
            top.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        done?.resume(returning: urls.first)
        done = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        done?.resume(returning: nil)
        done = nil
    }
}

/// 分享選單：送出回 true，取消回 false。
@MainActor
enum FlowFileSharer {
    static func share(_ name: String, _ bytes: Data, from button: PrintButton?, over view: UIView?) async -> Bool {
        guard let view, let top = topController(view), let file = temporaryFile(name, bytes) else { return false }
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = button.map { CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height) }
                ?? CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        return await withCheckedContinuation { continuation in
            var waiting: CheckedContinuation<Bool, Never>? = continuation
            // 只回一次（叫好幾次也不會回第二次）
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                waiting?.resume(returning: completed)
                waiting = nil
            }
            top.present(sheet, animated: true)
        }
    }
}
