// 情境測試用的殼：真的每一塊，要碰畫面、系統的換成假的。App 那邊照樣登記在 App/Bridge/ShellParts.swift。
// 一張票一格，各改自己那一格（中間空一行，幾張票同時加也合得起來，ios/README.md）：
//   - 假的東西放成 ScenarioShell 的屬性（例：let route = FakeAudioRoute()）
//   - parts 登記那一塊（用 outbox 和假的東西建）
//   - 情境裡有殼主動說的話（from: shell），在 triggers 登記「怎麼讓殼說這句」，key 是那句話的名字
//   - 情境開始前殼這邊要先準備好的（網頁看不到的，例：網站上放了哪一包），在 setups 登記，key 是情境的名字
import Foundation
import ShellCore

@MainActor
final class ScenarioShell {
    let outbox = ShellOutbox()
    private(set) var parts: [any BridgePart] = []
    private(set) var triggers: [String: @MainActor () async -> Void] = [:]
    private(set) var setups: [String: @MainActor () async -> Void] = [:]

    // 假的東西
    // #376

    // #377
    let drafts = DraftFolder.forScenario()

    // #378
    let settings = SettingsFile.forScenario()

    // #380

    // #381
    let roomSockets = FakeRoomSockets()
    private(set) lazy var cloudRoom = CloudRoomPart(
        site: SiteAddress.production, cookie: { "__Host-id=abc" }, outbox: outbox, connect: roomSockets.connect)

    // #383
    let offline = OfflineFolder.forScenario()

    // #384：交給 App 的檔、選檔畫面選到的（nil 是按取消）
    var picked: URL?
    private(set) lazy var openFile = OpenFilePart(outbox: outbox, pick: { self.picked }, places: places)

    // #385：原地打開的檔、存檔畫面存的都放這個資料夾（書籤是檔名）；askWhere 是存檔畫面（nil 是按取消）
    let fileFolder = handedFile("x").deletingLastPathComponent()
    private(set) lazy var places = FilePlaces.forScenario(folder: fileFolder)
    var savesAt: String? = "新流程.cheer"
    private(set) var sharedFiles: [String] = []
    private(set) lazy var saveFile = SaveFilePart(
        askWhere: { _, bytes in
            guard let name = self.savesAt else { return nil }
            let url = self.fileFolder.appendingPathComponent(name)
            try? bytes.write(to: url)
            return url
        },
        share: { name, _, _ in self.sharedFiles.append(name); return true },
        places: places)

    // #389
    lazy var nowPlaying = NowPlayingPart(outbox: outbox, show: { _ in })

    // #391
    private(set) var printedFrom: [PrintButton?] = []

    // #393
    /// 假網站和殼自己更新網頁的那一塊（WebUpdaterTests 的 Updater）。
    let webSite = try! Updater()
    private(set) lazy var webUpdate = WebUpdatePart(updater: webSite.updater, outbox: outbox, reload: { _ in })

    /// 測試自己建的殼（ScenarioTests 測情境的跑法用）。
    init(parts: [any BridgePart], triggers: [String: @MainActor () async -> Void]) {
        self.parts = parts
        self.triggers = triggers
    }

    /// 真的每一塊。
    init() {
        parts = [
            ReadyPart(onReady: {}),
            // #376
            ScreenPart(onScreen: { _ in }),

            // #377
            DraftsPart(folder: drafts, outbox: outbox),

            // #378
            SettingsPart(file: settings),

            // #380
            SitePart(site: SiteAddress.production),

            // #381
            cloudRoom,

            // #382
            CloudMusicPart(),

            // #383
            OfflinePart(folder: offline),

            // #384
            openFile,

            // #385
            saveFile,

            // #389
            nowPlaying,

            // #391
            PrintPart(onPrint: { self.printedFrom.append($0) }),

            // #393
            webUpdate,
        ]
        let triggerList: [(String, @MainActor () async -> Void)] = [
            // 例：("routeChanged", { self.route.change(to: .bluetooth) }),
            // #376

            // #377
            ("background", { DraftsPart(folder: self.drafts, outbox: self.outbox).appGoingAway() }),

            // #380

            // #381：伺服器接受了最後開的那條、說了一句；切到背景；回到前景
            ("socketOpened", { self.roomSockets.last?.open() }),
            ("socketMessage", { self.roomSockets.last?.say("{\"kind\":\"ready\"}") }),
            ("socketClosed", { self.cloudRoom.enterBackground() }),
            ("foreground", { self.cloudRoom.enterForeground() }),

            // #384：「檔案」點了 .cheer
            ("fileOpened", { self.openFile.handOver(handedFile("全國賽.cheer")) }),

            // #389
            ("remote", { self.nowPlaying.press(.togglePlayPause) }),

            // #391

            // #393
            ("webBundleReady", { self.webSite.site.publish(newFiles); await self.webUpdate.check() }),
        ]
        triggers = Dictionary(uniqueKeysWithValues: triggerList)
        let setupList: [(String, @MainActor () async -> Void)] = [
            // #384：點流程檔打開 App（網頁還沒起來就交了）；選檔畫面選了 .zip
            ("點流程檔打開 App：網頁一開始先拿那個檔；拿過就沒了，重新載入不會又打開", { self.openFile.handOver(handedFile("全國賽.cheer")) }),
            ("App 裡按「開啟流程檔」：殼叫出選檔畫面，選了回那個檔", { self.picked = self.inFolder("全國賽.zip") }),

            // #385：「檔案」點了 .cheer（原檔）；App 關掉再開時那個檔還在；存檔畫面按取消
            ("從「檔案」打開的流程檔：存檔蓋回原本那個檔，不問存到哪", { self.openFile.handOver(self.inFolder("全國賽.cheer"), inPlace: true) }),
            ("App 關掉再開：網頁交回記著的書籤，蓋回同一個檔", { _ = self.inFolder("全國賽.cheer") }),
            ("新的流程第一次存檔，存到哪按取消：回 null", { self.savesAt = nil }),

            // #393

            // #394：網站上放好新的一包（不用比這個殼新的殼）；放了要比這個殼新的殼的一包。都沒放：網站抓不到清單
            ("雲端流程被擋：新網頁好了，按更新馬上換、回到同一支流程", { self.webSite.site.publish(newFiles) }),
            ("雲端流程被擋：網站上的要比這個殼新的殼，不換", { self.webSite.site.publish(newFiles, minShellBuild: 2) }),
        ]
        setups = Dictionary(uniqueKeysWithValues: setupList)
    }

    /// 在 fileFolder 放一個流程檔（情境裡的那支「全國賽」），回它的網址。
    func inFolder(_ name: String) -> URL {
        let url = fileFolder.appendingPathComponent(name)
        try! scenarioFlowFile.write(to: url)
        return url
    }
}
