//! 用 QuickJS 跑流程核心（`src/lib/core/`，ADR 0013）：前端和伺服器跑同一份規則。
//!
//! QuickJS 的 runtime 不能跨執行緒，所以開一條專用執行緒擁有它；要跑核心的事都排隊交給它，
//! 照收到的先後一次一件（ADR 0010 本來就照收到的先後套）。

use std::sync::mpsc;

use rquickjs::{CatchResultExt, Context, Ctx, Function, Object, Runtime};
use unicode_segmentation::UnicodeSegmentation;

/// 流程核心那一包（build.rs 用 `scripts/core-bundle.mjs` 打包）：全域變數 `flowCore`。
pub const CODE: &str = include_str!(concat!(env!("OUT_DIR"), "/flow-core.js"));

/// 那一包的指紋（SHA-256）。前端帶的是同一個，連上時比對。
pub const FINGERPRINT: &str = include_str!(concat!(env!("OUT_DIR"), "/flow-core.fingerprint"));

/// QuickJS 沒有 `Intl.Segmenter`：流程核心算字數（text-length.ts）只用到照看得到的字切，
/// 由 Rust 的 unicode-segmentation 切（`__graphemeStarts` 回每個字開頭的 UTF-16 位置）。
const SEGMENTER_SHIM: &str = r#"
if (typeof Intl === 'undefined') globalThis.Intl = {};
if (!Intl.Segmenter) {
	Intl.Segmenter = class Segmenter {
		segment(input) {
			const starts = __graphemeStarts(input);
			return starts.map((index, i) => ({
				segment: input.slice(index, i + 1 < starts.length ? starts[i + 1] : input.length),
				index,
				input
			}));
		}
	};
}
"#;

/// 每個看得到的字開頭在第幾個 UTF-16 code unit（JS 字串的位置）。
fn grapheme_starts(text: String) -> Vec<u32> {
    let mut at = 0;
    text.graphemes(true)
        .map(|g| {
            let start = at;
            at += g.encode_utf16().count() as u32;
            start
        })
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    /// 流程核心丟了例外（例：參數不是 JSON）。
    #[error("流程核心出錯：{0}")]
    Js(String),
    /// 跑流程核心的執行緒停了。
    #[error("流程核心停了")]
    Stopped,
}

type Job = Box<dyn for<'js> FnOnce(&Ctx<'js>) + Send>;

/// 交事情給跑流程核心的那條執行緒。可以複製，大家共用同一條；全部丟掉時執行緒自己結束。
#[derive(Clone)]
pub struct FlowCore {
    jobs: mpsc::Sender<Job>,
}

impl FlowCore {
    /// 開執行緒、載入流程核心。
    pub fn start() -> Result<Self, CoreError> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        let (ready, loaded) = mpsc::channel();
        std::thread::Builder::new()
            .name("flow-core".into())
            .spawn(move || {
                let context = match load() {
                    Ok(context) => {
                        ready.send(Ok(())).ok();
                        context
                    }
                    Err(e) => {
                        ready.send(Err(e)).ok();
                        return;
                    }
                };
                while let Ok(job) = inbox.recv() {
                    context.with(|ctx| job(&ctx));
                }
            })
            .map_err(|e| CoreError::Js(e.to_string()))?;
        loaded.recv().map_err(|_| CoreError::Stopped)??;
        Ok(Self { jobs })
    }

    /// 排進隊伍（一叫就排，不用等 await），輪到時在流程核心裡跑 `job`。
    fn submit<R, F>(&self, job: F) -> impl Future<Output = Result<R, CoreError>> + use<R, F>
    where
        R: Send + 'static,
        F: for<'js> FnOnce(&Ctx<'js>) -> R + Send + 'static,
    {
        let (reply, answer) = tokio::sync::oneshot::channel();
        let sent = self.jobs.send(Box::new(move |ctx| {
            reply.send(job(ctx)).ok();
        }));
        async move {
            sent.map_err(|_| CoreError::Stopped)?;
            answer.await.map_err(|_| CoreError::Stopped)
        }
    }

    /// 用名字＋參數跑一串指令（`runCommands`）：flow 是流程的 JSON（沒有開著的流程是 `null`），
    /// commands 是指令串的 JSON，step_id 是這一步的步驟 id（新東西的 id 由它算出來，ADR 0014）。
    /// 回結果的 JSON，跟前端用同一個步驟 id 跑出來的逐位元組一樣。
    pub fn run_commands(
        &self,
        flow: String,
        commands: String,
        step_id: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, "runCommandsJson", (flow, commands, step_id))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }

    /// 比對改之前、改之後的流程（`remoteChangeJson`）：回要送給房間裡其他人的改動的 JSON（#253）。
    /// 伺服器現在由 takeStep 一起算好要送的改動；這個只在測試用。
    pub fn remote_change(
        &self,
        before: String,
        after: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        self.call_two("remoteChangeJson", before, after)
    }

    /// 把別人的改動套在一份流程上（`applyRemoteChangeJson`），回套好的流程的 JSON。
    /// 前端收到改動時做的事；伺服器只在測試用（套上去要跟伺服器一樣）。
    pub fn apply_remote_change(
        &self,
        flow: String,
        change: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        self.call_two("applyRemoteChangeJson", flow, change)
    }

    /// 雲端流程跑一步（`runStepJson`，ADR 0011）：records 是分開存的紀錄（StoredAttempt[] 的 JSON），
    /// 先放回 flow 再跑 commands，跑完拿出來。成功時結果的 flow 不帶紀錄，records 是跑完還在的紀錄。
    pub fn run_step(
        &self,
        flow: String,
        records: String,
        commands: String,
        step_id: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, "runStepJson", (flow, records, commands, step_id))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }

    /// 這一步收不收（`takeStepJson`，ADR 0018）：ask 是流程核心 StepAsk 的 JSON（現在的編排、第幾步、紀錄、
    /// 步驟紀錄、現在、送的人、送來的步），回 StepVerdict 的 JSON（收過、退回和原因，或收了和要存的）。
    pub fn take_step(
        &self,
        ask: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, "takeStepJson", (ask,))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }

    /// 收紀錄時照「記一次」的規則檢查（`checkRecordsJson`）：records 是 StoredAttempt[] 的 JSON，
    /// 回每一次的結果（照收，或整筆不存和原因）的 JSON，順序一樣。
    pub fn check_records(
        &self,
        flow: String,
        records: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, "checkRecordsJson", (flow, records))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }

    /// 傳上雲端（`uploadFlowJson`，#259）：doc 是流程檔裡 flow.json 的內容。跑「檢查一整支流程」和「整份流程檢查」，
    /// 回結果的 JSON：不收帶原因；收了帶不帶紀錄的編排和拿出來的紀錄（StoredAttempt[]）。
    pub fn upload_flow(
        &self,
        doc: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, "uploadFlowJson", (doc,))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }

    fn call_two(
        &self,
        name: &'static str,
        a: String,
        b: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, name, (a, b))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }
}

fn call<'js>(
    ctx: &Ctx<'js>,
    name: &str,
    args: impl rquickjs::function::IntoArgs<'js>,
) -> rquickjs::Result<String> {
    let core: Object = ctx.globals().get("flowCore")?;
    let f: Function = core.get(name)?;
    f.call(args)
}

/// 開 QuickJS、裝切字墊片、載入流程核心那一包。
fn load() -> Result<Context, CoreError> {
    let js = |e: rquickjs::Error| CoreError::Js(e.to_string());
    let runtime = Runtime::new().map_err(js)?;
    let context = Context::full(&runtime).map_err(js)?;
    context
        .with(|ctx| {
            ctx.globals().set(
                "__graphemeStarts",
                Function::new(ctx.clone(), grapheme_starts)?,
            )?;
            ctx.eval::<(), _>(SEGMENTER_SHIM)?;
            ctx.eval::<(), _>(CODE)
        })
        .map_err(js)?;
    Ok(context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// 好幾個請求同時來：照排進去的順序，一件做完才做下一件。
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn requests_run_one_at_a_time_in_order() {
        let core = FlowCore::start().unwrap();
        // 每件事：記下開始、結束的時間，和 JS 裡前面做完了幾件（同一個 runtime 裡的全域變數）。
        let jobs: Vec<_> = (0..8)
            .map(|i| {
                core.submit(move |ctx| {
                    let start = Instant::now();
                    let seen: u32 = ctx
                        .eval("globalThis.done = (globalThis.done ?? 0) + 1; done - 1")
                        .unwrap();
                    std::thread::sleep(Duration::from_millis(20));
                    (i, seen, start, Instant::now())
                })
            })
            .collect();
        // 同時等（分到不同的 tokio 執行緒上）。
        let handles: Vec<_> = jobs.into_iter().map(tokio::spawn).collect();
        let mut done = Vec::new();
        for h in handles {
            done.push(h.await.unwrap().unwrap());
        }

        for (i, seen, _, _) in &done {
            assert_eq!(seen, i, "第 {i} 件前面應該剛好做完 {i} 件");
        }
        for pair in done.windows(2) {
            assert!(pair[0].3 <= pair[1].2, "前一件做完，下一件才開始");
        }
    }

    /// 量「這一步收不收」（takeStepJson，#315）在 QuickJS 一步要多久，跟 #323 以前伺服器做的（runStepJson + remoteChangeJson）比。
    /// 約 1 MB 的流程（tests/fixtures/big-flow.js），步驟紀錄 0、100、1,000、5,000 筆；restore 是復原一次加回 5,500 次。只印數字、不比時間（機器不同），
    /// 所以平常不跑：`cargo test --release --lib -- --ignored --nocapture room_step_timing`。結果寫在 ADR 0018。
    #[test]
    #[ignore = "量時間用，手動跑"]
    fn room_step_timing() {
        let context = load().unwrap();
        context.with(|ctx| {
            ctx.eval::<(), _>(include_str!("../tests/fixtures/big-flow.js")).unwrap();
            // 伺服器存的樣子（JSON 字串），和三種步：改名字、插入一個八拍（後面的動作、站位全部往後挪）、復原改名字。
            ctx.eval::<(), _>(
                r#"
                const big = bigFlow();
                const C = flowCore;
                globalThis.FLOW = JSON.stringify(big.flow);
                globalThis.RECORDS = JSON.stringify(big.records);
                globalThis.WHOLE = JSON.stringify(C.putRecords(big.flow, big.records)).length;
                const seg = big.flow.segments[0].id;
                globalThis.COMMANDS = {
                    rename: [{ name: 'renameFlow', args: ['決賽'] }],
                    insertBeats: [{ name: 'insertBeats', args: [{ segmentId: seg, at: 0 }, 1, 'eight'] }],
                };
                const renamed = C.runCommands(big.flow, COMMANDS.rename, 'renamed');
                globalThis.RENAMED = JSON.stringify(renamed.flow);
                globalThis.UNDO = C.undoChanges(big.flow, renamed.flow).undo;
                // 步驟紀錄 n 筆：第 1 到 n 步，別的分頁、改到別的東西（隊員），復原時第 1 步是要復原的那一步（我改名字）。
                globalThis.ask = (n, kind) => {
                    const step = n;
                    const log = [];
                    for (let i = 1; i <= n; i++) {
                        const m = big.flow.members[i % 36].id;
                        log.push({ step: i, id: 's' + i, tab: 'other', by: '王教練', at: Date.UTC(2026, 10, 20), keys: ['member:' + m], cleared: [] });
                    }
                    const undo = kind === 'undo' || kind === 'restore';
                    // restore：復原的那一步（改名字）同時清掉了全部 5,500 次，現在都清掉著：一次全部加回來
                    const restore = kind === 'restore';
                    const cleared = restore ? big.records.map((r) => ({ was: r, now: null })) : [];
                    if (undo) log[0] = { ...log[0], id: 'renamed', tab: 'mine', keys: ['name'], cleared };
                    const sent = undo
                        ? { stepId: 'new', seen: step, undo: { of: 'renamed', redo: false, change: UNDO } }
                        : { stepId: 'new', seen: n > 0 ? 1 : 0, commands: COMMANDS[kind] };
                    return JSON.stringify({
                        flow: undo ? JSON.parse(RENAMED) : big.flow, step, log, now: Date.UTC(2026, 10, 21),
                        records: restore ? big.records.map((r) => ({ ...r, gone: true })) : big.records,
                        canEdit: true, tab: 'mine', by: '李教練', sent,
                    });
                };
                "#,
            )
            .unwrap();
            let flow: String = ctx.globals().get("FLOW").unwrap();
            let records: String = ctx.globals().get("RECORDS").unwrap();
            let whole: usize = ctx.globals().get("WHOLE").unwrap();
            println!(
                "流程（不帶紀錄）{} bytes、紀錄 {} bytes（5,500 次）、整支含紀錄 {} bytes",
                flow.len(),
                records.len(),
                whole
            );

            /// 跑 3 次暖身、再跑 25 次：最快、中位數、最慢（毫秒）。
            fn timed(mut once: impl FnMut()) -> (f64, f64, f64) {
                for _ in 0..3 {
                    once();
                }
                let mut ms: Vec<f64> = (0..25)
                    .map(|_| {
                        let start = Instant::now();
                        once();
                        start.elapsed().as_secs_f64() * 1000.0
                    })
                    .collect();
                ms.sort_by(f64::total_cmp);
                (ms[0], ms[ms.len() / 2], ms[ms.len() - 1])
            }

            // 量尺：ADR 0013 量的做法（整支含紀錄的流程跑 runCommandsJson），當時本機 rename 23 ms、insertBeats 52 ms。
            // 這台機器現在忙不忙，看這兩個數字比當時多幾倍。
            let whole_flow: String = ctx
                .eval("JSON.stringify(C.putRecords(big.flow, big.records))")
                .unwrap();
            for kind in ["rename", "insertBeats"] {
                let commands: String = ctx
                    .eval(format!("JSON.stringify(COMMANDS.{kind})"))
                    .unwrap();
                let (min, median, max) = timed(|| {
                    let args = (whole_flow.clone(), commands.clone(), "new".to_owned());
                    let out = call(&ctx, "runCommandsJson", args).unwrap();
                    assert!(out.starts_with(r#"{"kind":"ok""#));
                });
                println!(
                    "量尺 runCommands（ADR 0013 的做法）{kind}: 最快 {min:.1}、中位數 {median:.1}、最慢 {max:.1} ms"
                );
            }

            // #323 以前伺服器做的：runStepJson（復原是 runUndoJson），再 remoteChangeJson（兩次進出 QuickJS）。
            let renamed: String = ctx.globals().get("RENAMED").unwrap();
            let undo: String = ctx.eval("JSON.stringify(UNDO)").unwrap();
            for kind in ["rename", "insertBeats", "undo"] {
                let commands: String = ctx
                    .eval(format!("JSON.stringify(COMMANDS.{kind} ?? null)"))
                    .unwrap();
                let (min, median, max) = timed(|| {
                    let (before, out) = if kind == "undo" {
                        let out = call(&ctx, "runUndoJson", (renamed.clone(), records.clone(), undo.clone()));
                        (&renamed, out.unwrap())
                    } else {
                        let args = (flow.clone(), records.clone(), commands.clone(), "new".to_owned());
                        (&flow, call(&ctx, "runStepJson", args).unwrap())
                    };
                    assert!(out.starts_with(r#"{"kind":"ok""#), "{}", &out[..200.min(out.len())]);
                    // 拿結果裡的 flow 比對改動（借用、不複製）；只是量時間用，伺服器現在由 takeStep 一起算好要送的改動。
                    #[derive(serde::Deserialize)]
                    struct Outcome<'a> {
                        #[serde(borrow)]
                        flow: &'a serde_json::value::RawValue,
                    }
                    let after: Outcome = serde_json::from_str(&out).unwrap();
                    call(&ctx, "remoteChangeJson", (before.clone(), after.flow.get().to_owned())).unwrap();
                });
                println!(
                    "#323 以前 runStep+remoteChange {kind}: 最快 {min:.1}、中位數 {median:.1}、最慢 {max:.1} ms"
                );
            }

            for n in [0, 100, 1_000, 5_000] {
                for kind in ["rename", "insertBeats", "undo", "restore"] {
                    if (kind == "undo" || kind == "restore") && n == 0 {
                        continue;
                    }
                    let ask: String = ctx.eval(format!("ask({n}, '{kind}')")).unwrap();
                    if kind == "restore" {
                        // 量之前先確認真的全部加回來：只加回一部分也會 accepted，時間看起來還更快
                        let out = call(&ctx, "takeStepJson", (ask.clone(),)).unwrap();
                        let out: serde_json::Value = serde_json::from_str(&out).unwrap();
                        let all: usize = ctx.eval("JSON.parse(RECORDS).length").unwrap();
                        assert_eq!(out["changed"].as_array().map(Vec::len), Some(all), "restore 沒有全部加回來");
                    }
                    let (min, median, max) = timed(|| {
                        let out = call(&ctx, "takeStepJson", (ask.clone(),)).unwrap();
                        assert!(out.starts_with(r#"{"kind":"accepted""#), "{}", &out[..300.min(out.len())]);
                    });
                    println!(
                        "takeStep 步驟紀錄 {n} 筆（{} bytes）{kind}: 最快 {min:.1}、中位數 {median:.1}、最慢 {max:.1} ms",
                        ask.len()
                    );
                }
            }
        });
    }

    #[test]
    fn grapheme_starts_are_utf16_positions() {
        // 「中」1 個、家庭 emoji 11 個、a 1 個 UTF-16 code unit。
        assert_eq!(grapheme_starts("中👨‍👩‍👧‍👦a".into()), vec![0, 1, 12]);
        assert_eq!(grapheme_starts(String::new()), Vec::<u32>::new());
    }
}
