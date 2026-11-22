// 共用的情境檔（repo 根目錄 bridge-scenarios/，#375）：網頁的假殼（Vitest）和這裡跑的是同一份。
// 這裡把每個情境餵給真的殼程式（ScenarioParts）：一開始塞的對得上；網頁說的每一句，殼回的對得上。
import Foundation
import Testing
import ShellCore

struct ScenarioFile: Decodable {
    let scenarios: [Scenario]
}

struct Scenario: Decodable, CustomTestStringConvertible {
    struct Step: Decodable {
        let from: String
        let name: String
        let body: JSONValue?
        let reply: JSONValue?
        let error: String?
    }
    let name: String
    let boot: [String: JSONValue]
    let steps: [Step]
    var file = ""
    var testDescription: String { "\(file)：\(name)" }

    enum CodingKeys: String, CodingKey { case name, boot, steps }
}

/// bridge-scenarios/ 底下的每一份（current/ 和以後凍的 1.x/ 都是：凍的那份殼還認得才對）。
func allScenarios() throws -> [Scenario] {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("bridge-scenarios")
    let fm = FileManager.default
    var out: [Scenario] = []
    for folder in try fm.contentsOfDirectory(atPath: root.path).sorted() {
        let dir = root.appendingPathComponent(folder)
        guard (try? dir.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true else { continue }
        for name in try fm.contentsOfDirectory(atPath: dir.path).sorted() where name.hasSuffix(".json") {
            let file = try JSONDecoder().decode(ScenarioFile.self, from: Data(contentsOf: dir.appendingPathComponent(name)))
            out += file.scenarios.map { var s = $0; s.file = "\(folder)/\(name)"; return s }
        }
    }
    return out
}

/// 照情境演一次：一開始塞的對得上；網頁說的每一句，殼回的對得上；殼主動說的話，用 triggers 觸發後殼真的說了。
@MainActor
func play(_ scenario: Scenario, on shell: ScenarioShell) async {
    guard case .string(let version) = scenario.boot["shellVersion"],
          case .number(let build) = scenario.boot["shellBuild"] else {
        Issue.record("情境的 boot 要有 shellVersion、shellBuild"); return
    }
    var said: [JSONValue] = []
    shell.outbox.deliver = { name, body in said.append(["name": .string(name), "body": body]) }
    let bridge = Bridge(shellVersion: version, shellBuild: Int(build), parts: shell.parts)

    // 一開始塞的：情境寫的每一樣都要一樣；features 是「殼至少會這些」（新殼可以多會幾件）
    for (key, want) in scenario.boot {
        if key == "features", case .array(let want) = want, case .array(let have)? = bridge.boot[key] {
            #expect(Set(want).isSubset(of: Set(have)), "殼不會情境要的：\(want)")
        } else {
            #expect(bridge.boot[key] == want, "一開始塞的 \(key)")
        }
    }

    for step in scenario.steps {
        switch step.from {
        case "web":
            let answer = await bridge.handle(name: step.name, body: step.body ?? .null)
            let want: BridgeAnswer = step.error.map(BridgeAnswer.error) ?? .reply(step.reply ?? .null)
            #expect(answer == want, "網頁說 \(step.name)")
        case "shell":
            guard let trigger = shell.triggers[step.name] else {
                Issue.record("ScenarioParts.swift 的 triggers 沒有「\(step.name)」：不知道怎麼讓殼說這句"); continue
            }
            said.removeAll()
            await trigger()
            #expect(said == [["name": .string(step.name), "body": step.body ?? .null]], "殼主動說 \(step.name)")
        default:
            Issue.record("情境的 from 只能是 web 或 shell：\(step.from)")
        }
    }
}

@MainActor
struct ScenarioTests {
    @Test func 情境檔讀得到() throws {
        #expect(try allScenarios().count >= 3)
    }

    @Test(arguments: try allScenarios())
    func 殼照情境說話(_ scenario: Scenario) async {
        await play(scenario, on: ScenarioShell())
    }

    /// 跑法本身：用一塊只在這裡的「ping」，網頁問、殼主動說都走一次。
    struct PingPart: BridgePart {
        let outbox: ShellOutbox
        var feature: String? { "ping" }
        var messages: Set<String> { ["ping"] }
        func handle(name: String, body: JSONValue) async throws -> JSONValue { "pong" }
        func knock() { outbox.emit("knocked", ["times": 2]) }
    }

    @Test func 情境的跑法_網頁問和殼主動說都對得上() async throws {
        let scenario = try JSONDecoder().decode(Scenario.self, from: Data("""
            {"name": "ping", "boot": {"shellVersion": "1", "shellBuild": 1, "features": ["ping"]},
             "steps": [{"from": "web", "name": "ping", "reply": "pong"}, {"from": "shell", "name": "knocked", "body": {"times": 2}}]}
            """.utf8))
        let outbox = ShellOutbox()
        let part = PingPart(outbox: outbox)
        let shell = ScenarioShell(parts: [part], triggers: ["knocked": { part.knock() }])
        // 這塊說的話轉到 ScenarioShell 的 outbox（play 在那裡記）
        outbox.deliver = { shell.outbox.emit($0, $1) }
        await play(scenario, on: shell)
    }
}

