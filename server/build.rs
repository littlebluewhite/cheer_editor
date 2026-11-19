use std::path::Path;
use std::process::Command;

fn main() {
    // 遷移是編譯時包進程式的；只加了新的 .sql 檔，Cargo 不會自己重編，所以叫它看著這個資料夾。
    println!("cargo:rerun-if-changed=migrations");
    bundle_flow_core();
}

/// 把流程核心打包成一個 JS 檔、算好指紋，放進 OUT_DIR（src/flow_core.rs 編進程式；ADR 0013）。
/// 前端建置用同一支 scripts/core-bundle.mjs 算指紋，所以兩邊一樣。要先在專案根目錄 `npm ci`。
fn bundle_flow_core() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    for watched in [
        "src/lib/core",
        "scripts/core-bundle.mjs",
        "package-lock.json",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(watched).display());
    }
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let status = Command::new("node")
        .arg(root.join("scripts/core-bundle.mjs"))
        .arg(&out_dir)
        .current_dir(&root)
        .status()
        .expect("打包流程核心要用 node：先裝 node，再到專案根目錄 npm ci");
    assert!(
        status.success(),
        "打包流程核心失敗（先到專案根目錄 npm ci）"
    );
}
