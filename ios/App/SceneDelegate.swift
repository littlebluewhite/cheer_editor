// 唯一的視窗：整個畫面就是包在 App 裡的網頁。從「檔案」、分享選單交來的流程檔也從這裡進來（#384）。
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = ShellViewController()
        window.makeKeyAndVisible()
        self.window = window
        // 點流程檔打開 App（#384）：App 原本沒開著
        open(connectionOptions.urlContexts)
    }

    /// App 開著時「檔案」點了 .cheer、分享選單交來 .zip、.cheer（#384）。
    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        open(contexts)
    }

    private func open(_ contexts: Set<UIOpenURLContext>) {
        guard let context = contexts.first, context.url.isFileURL else { return }
        // 「檔案」點的是原檔（openInPlace，存檔蓋回它，#385）；分享選單給的是副本
        (window?.rootViewController as? ShellViewController)?.openFile(context.url, inPlace: context.options.openInPlace)
    }
}
