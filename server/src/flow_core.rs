//! 用 QuickJS 跑流程核心（`src/lib/core/`，ADR 0010）：前端和伺服器跑同一份規則。
//!
//! QuickJS 的 runtime 不能跨執行緒，所以開一條專用執行緒擁有它；要跑核心的事都排隊交給它，
//! 照收到的先後一次一件（ADR 0007 本來就照收到的先後套）。

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
    /// commands 是指令串的 JSON。回結果的 JSON，跟前端跑出來的逐位元組一樣。
    pub fn run_commands(
        &self,
        flow: String,
        commands: String,
    ) -> impl Future<Output = Result<String, CoreError>> + use<> {
        let result = self.submit(move |ctx| {
            call(ctx, "runCommandsJson", (flow, commands))
                .catch(ctx)
                .map_err(|e| CoreError::Js(e.to_string()))
        });
        async move { result.await? }
    }
}

fn call<'js>(ctx: &Ctx<'js>, name: &str, args: (String, String)) -> rquickjs::Result<String> {
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

    #[test]
    fn grapheme_starts_are_utf16_positions() {
        // 「中」1 個、家庭 emoji 11 個、a 1 個 UTF-16 code unit。
        assert_eq!(grapheme_starts("中👨‍👩‍👧‍👦a".into()), vec![0, 1, 12]);
        assert_eq!(grapheme_starts(String::new()), Vec::<u32>::new());
    }
}
