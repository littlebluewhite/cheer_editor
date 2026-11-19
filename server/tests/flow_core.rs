// 伺服器用 QuickJS 跑流程核心：同一串指令，結果跟 Node 跑的逐位元組一樣（ADR 0013）。
// Node 那邊跑的是同一包（cheer_server::flow_core::CODE），所以跑這些測試要裝 node。

use std::collections::HashMap;
use std::process::Command;

use serde_json::value::RawValue;

use cheer_server::flow_core::{self, FlowCore};

/// 範例流程：從沒有流程開始，一步一步（一步可以帶好幾個指令）用名字＋參數建出來；
/// 有成功、要選、要確認、一步裡第二個被擋。每一步是 `{ stepId, commands }`：新東西的 id 由步驟 id 算出來，
/// 後面的步照算出來的 id 寫。
const SAMPLE_STEPS: &str = include_str!("fixtures/sample-steps.json");

/// 照順序跑每一步：成功就換成新的流程，再跑下一步。每一步的結果（JSON）一行。
/// 跟下面 `run_steps` 做的是同一件事。
const NODE_RUN_STEPS: &str = r#"
const [code, steps] = process.argv.slice(1);
require('node:vm').runInThisContext(require('node:fs').readFileSync(code, 'utf8'));
let flow = 'null';
const out = [];
for (const step of JSON.parse(steps)) {
	const result = flowCore.runCommandsJson(flow, JSON.stringify(step.commands), step.stepId);
	out.push(result);
	const r = JSON.parse(result);
	if (r.kind === 'ok') flow = JSON.stringify(r.flow);
}
process.stdout.write(out.join('\n'));
"#;

fn node_run_steps(steps: &str) -> String {
    let dir = tempfile::tempdir().unwrap();
    let code = dir.path().join("flow-core.js");
    std::fs::write(&code, flow_core::CODE).unwrap();
    let out = Command::new("node")
        .arg("-e")
        .arg(NODE_RUN_STEPS)
        .arg(&code)
        .arg(steps)
        .output()
        .expect("要裝 node 才跑得了這個測試");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

async fn run_steps(core: &FlowCore, steps: &str) -> String {
    let steps: Vec<HashMap<String, Box<RawValue>>> = serde_json::from_str(steps).unwrap();
    let mut flow = "null".to_string();
    let mut out = Vec::new();
    for step in steps {
        let step_id: String = serde_json::from_str(step["stepId"].get()).unwrap();
        let result = core
            .run_commands(flow.clone(), step["commands"].get().to_string(), step_id)
            .await
            .unwrap();
        // 流程照原樣拿出來（不重新排鍵、不重寫數字），跟 Node 那邊 JSON.stringify(r.flow) 一樣。
        let r: HashMap<String, Box<RawValue>> = serde_json::from_str(&result).unwrap();
        if r["kind"].get() == r#""ok""# {
            flow = r["flow"].get().to_string();
        }
        out.push(result);
    }
    out.join("\n")
}

#[tokio::test]
async fn sample_flow_steps_match_node_byte_for_byte() {
    let core = FlowCore::start().unwrap();

    let quickjs = run_steps(&core, SAMPLE_STEPS).await;

    assert_eq!(quickjs, node_run_steps(SAMPLE_STEPS));
    // 真的有跑出東西：最後改好名字、刪人那步要問（保留還是清掉紀錄）。
    assert!(quickjs.contains(r#""name":"決賽 2026""#));
    assert!(quickjs.contains(r#""kind":"choose""#));
}

/// 名字長度照看得到的字算：流程名字最多 40 個字、隊員名字最多 20 個字。
/// 每一種字剛好到上限（成功）和多一個（被擋）。
#[tokio::test]
async fn name_lengths_count_the_same_as_node() {
    let core = FlowCore::start().unwrap();
    let kinds = [
        "中",                       // 中文
        "a",                        // 英文
        "👨‍👩‍👧‍👦",                       // 家庭 emoji（好幾個字用 ZWJ 接起來）
        "👍🏽",                       // 膚色
        "🇹🇼",                       // 國旗（兩個區域字母）
        "e\u{301}",                 // e 加上重音符號
        "\u{1100}\u{1161}\u{11A8}", // 韓文字母拼成一個字
        "\r\n",                     // 換行
    ];
    let mut steps = vec![serde_json::json!([{
        "name": "createFlow",
        "args": [{ "name": "開始", "field": { "strips": 9, "layout": "vertical" } }]
    }])];
    for kind in kinds {
        // 前後各一個 a，免得頭尾空白被去掉。
        for (n, field) in [(40, "flow"), (41, "flow"), (20, "member"), (21, "member")] {
            let name = format!("a{}a", kind.repeat(n - 2));
            steps.push(match field {
                "flow" => serde_json::json!([{ "name": "renameFlow", "args": [name] }]),
                _ => serde_json::json!([{
                    "name": "addMembers",
                    "args": [[{ "name": name, "gender": "F", "globalRole": "top" }]]
                }]),
            });
        }
    }
    let steps = steps
        .into_iter()
        .enumerate()
        .map(|(i, commands)| serde_json::json!({ "stepId": format!("step{i}"), "commands": commands }))
        .collect::<Vec<_>>();
    let steps = serde_json::Value::from(steps).to_string();

    let quickjs = run_steps(&core, &steps).await;

    assert_eq!(quickjs, node_run_steps(&steps));
    let blocked = quickjs.matches(r#""kind":"blocked""#).count();
    assert_eq!(
        blocked,
        kinds.len() * 2,
        "每一種字多一個時被擋，剛好到上限時不擋"
    );
    assert!(quickjs.contains("流程名字最多 40 個字"));
    assert!(quickjs.contains("隊員名字最多 20 個字"));
}

#[tokio::test]
async fn a_command_that_throws_comes_back_as_an_error() {
    let core = FlowCore::start().unwrap();

    let r = core
        .run_commands(
            "null".into(),
            r#"[{ "name": "renameFlow" }]"#.into(),
            "step1".into(),
        )
        .await;

    // 沒有流程時被擋（不丟例外）；參數壞掉丟例外時回錯誤，不會讓伺服器掛掉。
    assert!(r.unwrap().contains(r#""kind":"blocked""#));
    let r = core
        .run_commands("{}".into(), "not json".into(), "step2".into())
        .await;
    assert!(r.is_err());
    // 丟過例外之後照樣能跑。
    let r = core
        .run_commands("null".into(), SAMPLE_STEPS_FIRST.into(), "step3".into())
        .await;
    assert!(r.unwrap().starts_with(r#"{"kind":"ok""#));
}

const SAMPLE_STEPS_FIRST: &str = r#"[{ "name": "createFlow", "args": [{ "name": "測試", "field": { "strips": 9, "layout": "vertical" } }] }]"#;

/// 前端的指紋是 vite.config.ts 叫 bundleCore() 算的；伺服器帶的要跟它一樣（現在的原始碼打包出來的）。
#[test]
fn server_fingerprint_matches_what_the_frontend_computes() {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/core-bundle.mjs");
    let out = Command::new("node")
        .arg("--input-type=module")
        .arg("-e")
        .arg("const { bundleCore } = await import(process.argv[1]); process.stdout.write((await bundleCore()).fingerprint);")
        .arg(script)
        .output()
        .expect("要裝 node 才跑得了這個測試");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    assert_eq!(
        flow_core::FINGERPRINT,
        String::from_utf8(out.stdout).unwrap()
    );
    assert_eq!(flow_core::FINGERPRINT.len(), 64);
}
