// 存檔蓋回原本的檔、「傳給別人」（#385）。網頁和殼說的話在 bridge-scenarios/current/saveFile.json（ScenarioTests 跑，書籤是假的）；
// 這裡用真的書籤、真的 NSFileCoordinator（Mac 上，沒有 iOS 的 sandbox）：蓋回同一個檔、檔改了名字還找得到、記的地方壞了改問存到哪。
// 「檔案」點進來的檔、存到哪的畫面在 PipeTests 和手動試。
import Foundation
import Testing
import ShellCore

extension FilePlaces {
    /// 情境用的：書籤就是檔名（情境檔裡寫得出來），檔都在 folder 裡。
    static func forScenario(folder: URL) -> FilePlaces {
        FilePlaces(
            remember: { Data($0.lastPathComponent.utf8) },
            find: { data in
                guard let name = String(data: data, encoding: .utf8) else { return nil }
                let url = folder.appendingPathComponent(name)
                return FileManager.default.fileExists(atPath: url.path) ? (url, false) : nil
            },
            write: { bytes, url in try bytes.write(to: url) }
        )
    }
}

/// 資料夾裡有哪些檔（看有沒有多出新檔）。
private func names(in folder: URL) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted()
}

private func saveBody(target: String?, name: String, bytes: Data) -> JSONValue {
    ["target": target.map(JSONValue.string) ?? .null, "name": .string(name), "bytes": .string(bytes.base64EncodedString())]
}

private func target(of reply: JSONValue) -> String? {
    guard case .object(let o) = reply, case .string(let t)? = o["target"] else { return nil }
    return t
}

private func name(of reply: JSONValue) -> String? {
    guard case .object(let o) = reply, case .string(let n)? = o["name"] else { return nil }
    return n
}

@MainActor
struct SaveFilePartTests {
    @Test func 從檔案打開的_存檔蓋回原本那個檔_沒有多出新檔() async throws {
        let url = handedFile("全國賽.cheer", Data([1]))
        let opened = OpenFilePart()
        opened.handOver(url, inPlace: true)
        let taken = try await opened.handle(name: "takeOpenedFile", body: nil)
        let part = SaveFilePart(askWhere: { _, _ in Issue.record("不該問存到哪"); return nil })
        let reply = try await part.handle(name: "saveFlowFile", body: saveBody(target: target(of: taken), name: "全國賽.cheer", bytes: Data([2, 3])))
        #expect(try Data(contentsOf: url) == Data([2, 3]))
        #expect(names(in: url.deletingLastPathComponent()) == ["全國賽.cheer"])
        #expect(name(of: reply) == "全國賽.cheer")
        #expect(target(of: reply) != nil)
    }

    @Test func 分享選單交來的副本不記地方_第一次存檔問存到哪() async throws {
        let opened = OpenFilePart()
        opened.handOver(handedFile("全國賽.zip"), inPlace: false)
        #expect(target(of: try await opened.handle(name: "takeOpenedFile", body: nil)) == nil)
    }

    @Test func 開啟流程檔選的檔_記得地方() async throws {
        let url = handedFile("全國賽.cheer")
        let opened = OpenFilePart(pick: { url })
        #expect(target(of: try await opened.handle(name: "pickFlowFile", body: nil)) != nil)
    }

    @Test func 新的流程_第一次問存到哪_之後蓋回那裡不再問() async throws {
        let folder = handedFile("x").deletingLastPathComponent()
        var asked: [(String, Data)] = []
        let part = SaveFilePart(askWhere: { name, bytes in
            asked.append((name, bytes))
            let url = folder.appendingPathComponent(name)
            try? bytes.write(to: url)
            return url
        })
        let first = try await part.handle(name: "saveFlowFile", body: saveBody(target: nil, name: "新流程.cheer", bytes: Data([1])))
        #expect(asked.map(\.0) == ["新流程.cheer"])
        #expect(asked.map(\.1) == [Data([1])])
        #expect(name(of: first) == "新流程.cheer")
        let second = try await part.handle(name: "saveFlowFile", body: saveBody(target: target(of: first), name: "新流程.cheer", bytes: Data([2])))
        #expect(asked.count == 1)
        #expect(try Data(contentsOf: folder.appendingPathComponent("新流程.cheer")) == Data([2]))
        #expect(name(of: second) == "新流程.cheer")
    }

    @Test func 存到哪按取消_回null() async throws {
        let part = SaveFilePart(askWhere: { _, _ in nil })
        #expect(try await part.handle(name: "saveFlowFile", body: saveBody(target: nil, name: "新流程.cheer", bytes: Data([1]))) == nil)
    }

    @Test func 檔案在別的地方改了名字_還是蓋回那個檔() async throws {
        let url = handedFile("全國賽.cheer", Data([1]))
        let opened = OpenFilePart(pick: { url })
        let taken = try await opened.handle(name: "pickFlowFile", body: nil)
        let renamed = url.deletingLastPathComponent().appendingPathComponent("全國賽決賽.cheer")
        try FileManager.default.moveItem(at: url, to: renamed)
        let part = SaveFilePart(askWhere: { _, _ in Issue.record("不該問存到哪"); return nil })
        let reply = try await part.handle(name: "saveFlowFile", body: saveBody(target: target(of: taken), name: "全國賽.cheer", bytes: Data([9])))
        #expect(try Data(contentsOf: renamed) == Data([9]))
        #expect(name(of: reply) == "全國賽決賽.cheer")
    }

    @Test func 記的地方壞了_檔被刪了_改問存到哪() async throws {
        let url = handedFile("全國賽.cheer", Data([1]))
        let opened = OpenFilePart(pick: { url })
        let taken = try await opened.handle(name: "pickFlowFile", body: nil)
        try FileManager.default.removeItem(at: url.deletingLastPathComponent())
        var asked = 0
        let part = SaveFilePart(askWhere: { _, _ in asked += 1; return nil })
        #expect(try await part.handle(name: "saveFlowFile", body: saveBody(target: target(of: taken), name: "全國賽.cheer", bytes: Data([2]))) == nil)
        #expect(try await part.handle(name: "saveFlowFile", body: saveBody(target: "不是書籤", name: "全國賽.cheer", bytes: Data([2]))) == nil)
        #expect(asked == 2)
    }

    @Test func 蓋回原檔是寫好整份再換上_不在原檔上寫到一半() async throws {
        // 寫到一半失敗（空間不夠、App 被關掉）時原檔要還在：原本打開的那份看到的還是舊的位元組，資料夾裡沒多出別的檔
        let url = handedFile("全國賽.cheer", Data(repeating: 1, count: 4096))
        let before = try FileHandle(forReadingFrom: url)
        defer { try? before.close() }
        try await FilePlaces.inPlace.write(Data([9, 9]), url)
        #expect(try Data(contentsOf: url) == Data([9, 9]))
        #expect(try before.readToEnd() == Data(repeating: 1, count: 4096))
        #expect(names(in: url.deletingLastPathComponent()) == ["全國賽.cheer"])
    }

    @Test func 蓋回原檔_檔被刪了不在原地重建() async throws {
        let url = handedFile("全國賽.cheer", Data([1]))
        try FileManager.default.removeItem(at: url)
        await #expect(throws: (any Error).self) { try await FilePlaces.inPlace.write(Data([9]), url) }
        #expect(names(in: url.deletingLastPathComponent()) == [])
    }

    @Test func 傳給別人_交給分享選單_回有沒有送出() async throws {
        var shared: [(String, Data, PrintButton?)] = []
        var sent = true
        let part = SaveFilePart(askWhere: { _, _ in nil }, share: { name, bytes, button in
            shared.append((name, bytes, button))
            return sent
        })
        let body: JSONValue = ["name": "全國賽.zip", "bytes": "AQI=", "button": ["x": 1, "y": 2, "width": 3, "height": 4]]
        #expect(try await part.handle(name: "shareFlowFile", body: body) == true)
        sent = false
        #expect(try await part.handle(name: "shareFlowFile", body: ["name": "全國賽.zip", "bytes": "AQI="]) == false)
        #expect(shared.map(\.0) == ["全國賽.zip", "全國賽.zip"])
        #expect(shared.map(\.1) == [Data([1, 2]), Data([1, 2])])
        #expect(shared.map(\.2) == [PrintButton(x: 1, y: 2, width: 3, height: 4), nil])
    }
}
