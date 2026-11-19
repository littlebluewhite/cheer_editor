//! 雲端流程的音樂檔（#249）：檔放 Cloudflare R2，不經過伺服器。
//! 上傳：伺服器查權限、發一個幾分鐘內有效的預簽網址，瀏覽器直接 PUT 到暫放的名字（`uploading/` 開頭）；
//! 傳完告訴伺服器，伺服器在 R2 複製到正式的名字，查正式的那份多大，超過 60 MB 就刪掉、退回；收了才刪暫放的。
//! 預簽網址收了之後還有效，但只寫得到暫放的，收好的不會被換掉（codex review）。播放：能打開流程的人拿下載的預簽網址。
//! 換掉、刪掉的音樂（流程裡不再有）記下哪天不用了（收一步時，見 flow_room）；30 天後真的刪在 #266。

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::AppState;
use crate::accounts::{AppError, SignedIn, signed_in};

/// 一個音樂檔最大幾個位元組（60 MB）。前端 `src/lib/music-library.svelte.ts` 的 MAX_CLOUD_AUDIO_BYTES 跟它一樣。
pub const MAX_AUDIO_BYTES: i64 = 60 * 1024 * 1024;

/// 放得下的音樂檔副檔名（跟流程核心的 AUDIO_EXTENSIONS 一樣）。
const EXTENSIONS: [&str; 3] = ["mp3", "m4a", "wav"];

/// 要傳一個音樂檔：流程裡音樂檔的 id、原始檔名（看副檔名）、說好的大小。
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StartUpload {
    pub audio_id: String,
    pub file_name: String,
    #[ts(type = "number")]
    pub size: i64,
}

/// 預簽網址：幾分鐘內有效，瀏覽器直接拿它傳（PUT）或拿（GET）。
#[derive(Serialize, TS)]
#[ts(export)]
pub struct Presigned {
    pub url: String,
}

/// 發上傳網址：要能改這支流程。說好的大小超過 60 MB 回 413；id、副檔名不對 400；
/// 這個音樂檔傳好過了（不能換內容）409；伺服器沒接 R2 回 503。重來時先刪掉上次沒收、已經複製好的那份。
pub async fn start_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(flow_id): Path<String>,
    Json(input): Json<StartUpload>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if !allowed(&state, &flow_id, user_id, Access::Edit).await? {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    let Some(store) = &state.music else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    let ext = extension(&input.file_name);
    let (Some(ext), true) = (ext, valid_audio_id(&input.audio_id)) else {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    };
    if input.size > MAX_AUDIO_BYTES {
        return Ok(StatusCode::PAYLOAD_TOO_LARGE.into_response());
    }
    let key = format!("flows/{flow_id}/{}.{ext}", input.audio_id);
    // 還沒傳完的可以重來（例：上次傳到一半斷線）；傳好的不能換。
    // 鎖住這一列到刪完上次的：同時有人說上次的傳完，等這裡做完才做（見 finish_upload）。
    let mut tx = state.db.begin().await?;
    // 新加的這一列 xmax 是 0；改到上次沒收的那列不是。
    let added: Option<(bool,)> = sqlx::query_as(
        "INSERT INTO flow_audio (flow_id, audio_id, object_key, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (flow_id, audio_id) DO UPDATE SET object_key = EXCLUDED.object_key
         WHERE flow_audio.size IS NULL
         RETURNING xmax = 0",
    )
    .bind(&flow_id)
    .bind(&input.audio_id)
    .bind(&key)
    .bind(state.clock.now())
    .fetch_optional(&mut *tx)
    .await?;
    let Some((first,)) = added else {
        return Ok(StatusCode::CONFLICT.into_response());
    };
    // 上次沒收的可能已經複製到正式的名字：刪掉，這次的暫放的不見了時才不會收成上次的（codex review）。
    // 第一次傳沒有上次的，不刪：R2 刪檔一時出錯不會害第一次傳也 500。
    if !first {
        store.delete(&key).await?;
    }
    tx.commit().await?;
    let url = store.upload_url(&uploading(&key));
    Ok(Json(Presigned { url }).into_response())
}

/// 傳完了：在 R2 把暫放的複製到正式的名字，查正式的那份多大（之後再 PUT 也只寫到暫放的），記下來再刪暫放的。
/// 超過 60 MB 就刪掉（R2 上的和這一列）、回 413；還沒傳上去 409；收了 204。中間出錯可以再說一次傳完。
/// 同一個音樂檔同時說兩次傳完：鎖住這一列，一個做完另一個才做。
pub async fn finish_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((flow_id, audio_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if !allowed(&state, &flow_id, user_id, Access::Edit).await? {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    let Some(store) = &state.music else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    let mut tx = state.db.begin().await?;
    let found: Option<(String, Option<i64>)> = sqlx::query_as(
        "SELECT object_key, size FROM flow_audio WHERE flow_id = $1 AND audio_id = $2 FOR UPDATE",
    )
    .bind(&flow_id)
    .bind(&audio_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((key, size)) = found else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    if size.is_some() {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    // 暫放的要記下來之後才刪：中間出錯時再說一次傳完，從暫放的重新複製。
    // 暫放的沒了（例：放了一天被 R2 刪掉），就用之前複製好的那份。
    store.copy(&uploading(&key), &key).await?;
    // 查複製好的那份（不是暫放的）：查完到記下來之間沒人寫得到它。
    let Some(size) = store.size(&key).await? else {
        return Ok(StatusCode::CONFLICT.into_response());
    };
    if size > MAX_AUDIO_BYTES {
        store.delete(&key).await?;
        store.delete(&uploading(&key)).await?;
        sqlx::query("DELETE FROM flow_audio WHERE flow_id = $1 AND audio_id = $2")
            .bind(&flow_id)
            .bind(&audio_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(StatusCode::PAYLOAD_TOO_LARGE.into_response());
    }
    sqlx::query("UPDATE flow_audio SET size = $3 WHERE flow_id = $1 AND audio_id = $2")
        .bind(&flow_id)
        .bind(&audio_id)
        .bind(size)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    // 已經收了：暫放的刪不掉也回收了（不然瀏覽器以為沒傳成，再試又 409），留給 R2 的生命週期規則刪。
    if let Err(err) = store.delete(&uploading(&key)).await {
        tracing::warn!(flow_id, audio_id, error = %err, "R2 上暫放的音樂刪不掉，留給生命週期規則");
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// 播放：能打開這支流程的人拿下載的預簽網址。沒有這個音樂檔（或還沒傳完）404。
pub async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((flow_id, audio_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let Some(SignedIn { user_id, .. }) = signed_in(&state, &headers).await? else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    if !allowed(&state, &flow_id, user_id, Access::Open).await? {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    let Some(store) = &state.music else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    let found: Option<(String,)> = sqlx::query_as(
        "SELECT object_key FROM flow_audio
         WHERE flow_id = $1 AND audio_id = $2 AND size IS NOT NULL",
    )
    .bind(&flow_id)
    .bind(&audio_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((key,)) = found else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    Ok(Json(Presigned {
        url: store.download_url(&key),
    })
    .into_response())
}

/// 收了一步之後（同一個 transaction）：流程裡不再有的音樂檔記下哪天不用了（已經記過的不動），
/// 又用到的（例：復原）變回還在用。
pub(crate) async fn note_unused(
    tx: &mut sqlx::PgConnection,
    flow_id: &str,
    flow: &str,
    now: DateTime<Utc>,
) -> anyhow::Result<()> {
    #[derive(Deserialize)]
    struct AudioRef {
        id: String,
    }
    #[derive(Deserialize)]
    struct Flow {
        audio: Vec<AudioRef>,
    }
    let flow: Flow = serde_json::from_str(flow)?;
    let used: Vec<String> = flow.audio.into_iter().map(|a| a.id).collect();
    sqlx::query(
        "UPDATE flow_audio
         SET unused_since = CASE WHEN audio_id = ANY($2) THEN NULL ELSE COALESCE(unused_since, $3) END
         WHERE flow_id = $1",
    )
    .bind(flow_id)
    .bind(&used)
    .bind(now)
    .execute(tx)
    .await?;
    Ok(())
}

/// 要做的事：打開（聽音樂）或改（放音樂）。
enum Access {
    Open,
    Edit,
}

/// 這個人能不能這樣碰這支流程：有權限的都能打開（聽音樂），擁有者、編輯者才能改（放音樂，#250）。
async fn allowed(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
    access: Access,
) -> anyhow::Result<bool> {
    let role = crate::sharing::role_of(&state.db, flow_id, user_id).await?;
    Ok(match access {
        Access::Open => role.is_some(),
        Access::Edit => role.is_some_and(|r| r.can_edit()),
    })
}

/// 瀏覽器 PUT 的暫放名字：收了才複製到正式的 `key`。沒收的留在這裡，R2 的生命週期規則過幾天刪掉（docs/deploy.md）。
fn uploading(key: &str) -> String {
    format!("uploading/{key}")
}

/// 檔名的副檔名（小寫）是放得下的音樂檔就回它。
fn extension(file_name: &str) -> Option<&'static str> {
    let (_, ext) = file_name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    EXTENSIONS.into_iter().find(|e| *e == ext)
}

/// 流程裡音樂檔的 id：小寫字母開頭，後面是小寫字母、數字（舊的 a1、新的 a 加 12 個字的亂數）。
fn valid_audio_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && id.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}
