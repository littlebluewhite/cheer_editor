// 放網頁畫面的那一頁：開 App 裡那包網頁（Web.bundle，npm run ios:web 放進來的）。
import ShellCore
import UIKit

final class ShellViewController: UIViewController {
    private var shell: WebShell?
    private var context: ShellContext?

    /// 「檔案」、分享選單交給 App 的流程檔（#384）：交給網頁打開。App 裡沒有網頁（沒跑 npm run ios:web）就不理。
    /// inPlace：「檔案」給的原檔（存檔蓋回它，#385）；分享選單給的是副本。
    func openFile(_ url: URL, inPlace: Bool = false) {
        loadViewIfNeeded()
        context?.openFile?.handOver(url, inPlace: inPlace)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // 網頁沒有深色模式：邊邊一直是淺的底色，狀態列的字也一直用深色（#376）
        overrideUserInterfaceStyle = .light
        view.backgroundColor = .systemBackground
        guard let site = Bundle.main.url(forResource: "Web", withExtension: "bundle") else {
            // 建置前沒跑 npm run ios:web（ios/README.md）
            let label = UILabel()
            label.text = "App 裡沒有網頁：先跑 npm run ios:web 再建"
            label.numberOfLines = 0
            label.frame = view.bounds.insetBy(dx: 24, dy: 24)
            label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(label)
            return
        }
        let info = Bundle.main.infoDictionary ?? [:]
        let context = ShellContext()
        let bridge = Bridge(
            shellVersion: info["CFBundleShortVersionString"] as? String ?? "0",
            shellBuild: Int(info["CFBundleVersion"] as? String ?? "") ?? 0,
            parts: ShellParts.all(context)
        )
        let shell = WebShell(siteRoot: site, bridge: bridge, routes: SchemeRoutes.all(context))
        context.attach(shell)
        // 網頁放在不會被擋的範圍裡，邊邊塗網頁的底色（#376）
        let feel = ScreenFeelView(webView: shell.webView)
        feel.frame = view.bounds
        feel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(feel)
        shell.webView.load(URLRequest(url: BundledSite.home))
        self.shell = shell
        self.context = context
    }
}
