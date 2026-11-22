// swift-tools-version: 6.0
// 殼的規則（ADR 0022）：不碰畫面的 Swift，App 和測試都用。`swift test` 在 Mac 上跑，不用模擬器（ios/README.md）。
import PackageDescription

let package = Package(
    name: "ShellCore",
    platforms: [.iOS("18.4"), .macOS("15.0")],
    products: [.library(name: "ShellCore", targets: ["ShellCore"])],
    targets: [
        .target(name: "ShellCore", resources: [.copy("Resources/bridge.js")]),
        .testTarget(name: "ShellCoreTests", dependencies: ["ShellCore"]),
    ]
)
