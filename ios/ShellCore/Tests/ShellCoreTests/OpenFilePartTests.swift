// 在 App 裡打開流程檔（#384）。網頁和殼說的話在 bridge-scenarios/current/openFile.json（ScenarioTests 跑）；
// 這裡測情境測不到的：殼不看內容（不是流程檔也照交）、讀不到的回錯、交了兩次只給最後那個。「檔案」點、分享選單在 PipeTests 和手動試。
import Foundation
import Testing
import ShellCore

/// 情境裡交給 App 的檔：一支叫「全國賽」的空流程（跟 openFile.json 的 bytes 一樣）。
let scenarioFlowFile = Data(base64Encoded: "UEsDBBQAAAAIAMY4eF3dPRWf2AAAACYBAAAJAAAAZmxvdy5qc29uNY89TgMxEIXv8moXWZAQuKWioAmIBqUwzixY8k9kj/nRyiUVV+AA6VPnOJFyjMzuJp393ps33wzoUw6GXygXlyJ0d6PQ+/QFPSCaQNA4/G4P/3/H3R5iOfLr0Suc3aZA3yl485MqS/CTMjtrPJoCu0DL6kkiA8ZizpUUgov3HybyE1no64UI5vuxFmcnobualefExs/K7ULKAoU3AYR+XSmYunZpfhZ6DxT5bMyXyBXjf4ATTvSdQJ9jDyLE6r1UCK1s2qSRrjWZtbVwCss0AU9b7KVp1doJUEsBAhQAFAAAAAgAxjh4Xd09FZ/YAAAAJgEAAAkAAAAAAAAAAAAAAAAAAAAAAGZsb3cuanNvblBLBQYAAAAAAQABADcAAAD/AAAAAAA=")!

/// 暫存資料夾裡寫一個檔，回它的網址。
func handedFile(_ name: String, _ bytes: Data = scenarioFlowFile) -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("handed-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent(name)
    try! bytes.write(to: url)
    return url
}

@MainActor
struct OpenFilePartTests {
    @Test func 交給App就跟網頁說一聲_網頁拿到檔名和位元組_拿過就沒了() async throws {
        var said: [String] = []
        let outbox = ShellOutbox()
        outbox.deliver = { name, _ in said.append(name) }
        let part = OpenFilePart(outbox: outbox)
        #expect(try await part.handle(name: "takeOpenedFile", body: nil) == nil)
        part.handOver(handedFile("全國賽.cheer"))
        #expect(said == ["fileOpened"])
        #expect(try await part.handle(name: "takeOpenedFile", body: nil)
            == ["name": "全國賽.cheer", "bytes": JSONValue.string(scenarioFlowFile.base64EncodedString())])
        #expect(try await part.handle(name: "takeOpenedFile", body: nil) == nil)
    }

    @Test func 殼不看內容_不是流程檔也照交_網頁說打不開() async throws {
        let part = OpenFilePart()
        part.handOver(handedFile("筆記.txt", Data("hi".utf8)))
        #expect(try await part.handle(name: "takeOpenedFile", body: nil) == ["name": "筆記.txt", "bytes": "aGk="])
    }

    @Test func 網頁還沒拿又交一個_給最後那個() async throws {
        let part = OpenFilePart()
        part.handOver(handedFile("舊的.cheer", Data([1])))
        part.handOver(handedFile("新的.cheer", Data([2])))
        #expect(try await part.handle(name: "takeOpenedFile", body: nil) == ["name": "新的.cheer", "bytes": "Ag=="])
    }

    @Test func 讀不到_網頁收到錯誤_也不再給() async throws {
        let part = OpenFilePart()
        part.handOver(FileManager.default.temporaryDirectory.appendingPathComponent("沒有-\(UUID().uuidString).cheer"))
        await #expect(throws: (any Error).self) { try await part.handle(name: "takeOpenedFile", body: nil) }
        #expect(try await part.handle(name: "takeOpenedFile", body: nil) == nil)
    }

    @Test func 開啟流程檔_選了回那個檔_按取消回null() async throws {
        var picked: URL? = handedFile("全國賽.zip")
        let part = OpenFilePart(pick: { picked })
        #expect(try await part.handle(name: "pickFlowFile", body: nil)
            == ["name": "全國賽.zip", "bytes": JSONValue.string(scenarioFlowFile.base64EncodedString())])
        picked = nil
        #expect(try await part.handle(name: "pickFlowFile", body: nil) == nil)
    }
}
