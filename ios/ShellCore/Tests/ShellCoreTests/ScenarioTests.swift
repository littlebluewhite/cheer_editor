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

@MainActor
struct ScenarioTests {
    @Test func 情境檔讀得到() throws {
        #expect(try allScenarios().count >= 3)
    }

    @Test(arguments: try allScenarios())
    func 殼照情境說話(_ scenario: Scenario) async throws {
        guard case .string(let version) = scenario.boot["shellVersion"],
              case .number(let build) = scenario.boot["shellBuild"] else {
            Issue.record("情境的 boot 要有 shellVersion、shellBuild"); return
        }
        let bridge = Bridge(shellVersion: version, shellBuild: Int(build), parts: ScenarioParts.all())

        // 一開始塞的：情境寫的每一樣都要一樣；features 是「殼至少會這些」（新殼可以多會幾件）
        for (key, want) in scenario.boot {
            if key == "features", case .array(let want) = want, case .array(let have)? = bridge.boot[key] {
                #expect(Set(want).isSubset(of: Set(have)), "殼不會情境要的：\(want)")
            } else {
                #expect(bridge.boot[key] == want, "一開始塞的 \(key)")
            }
        }

        for step in scenario.steps {
            guard step.from == "web" else {
                // 殼主動說的話：第一次有這種情境的票，在這裡接上觸發的方法（ios/README.md「情境檔」）
                Issue.record("還不會演殼主動說的話：\(step.name)"); continue
            }
            let answer = await bridge.handle(name: step.name, body: step.body ?? .null)
            let want: BridgeAnswer = step.error.map(BridgeAnswer.error) ?? .reply(step.reply ?? .null)
            #expect(answer == want, "網頁說 \(step.name)")
        }
    }
}
