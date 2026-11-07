-- 雲端流程的音樂檔（#249）：檔本身放 Cloudflare R2，不經過伺服器；這裡記是哪支流程的哪個音樂檔、在 R2 的名字、多大、哪天不用了。
-- 一列在發上傳網址時就加（size 是 NULL），傳完伺服器查過大小才填上。
-- 換掉、刪掉（流程裡不再有這個音樂檔）時記下哪天不用了；30 天後真的刪掉在 #266。

CREATE TABLE flow_audio (
    flow_id TEXT NOT NULL REFERENCES flows (id) ON DELETE CASCADE,
    -- 流程裡音樂檔的 id（flow.audio[].id）。
    audio_id TEXT NOT NULL,
    -- 在 R2 的名字：flows/<流程 id>/<音樂檔 id>.<副檔名>。
    object_key TEXT NOT NULL UNIQUE,
    -- 位元組數：伺服器在 R2 查過的；還沒傳完是 NULL。
    size BIGINT,
    created_at TIMESTAMPTZ NOT NULL,
    -- 哪天開始流程裡沒有這個音樂檔（換掉、刪掉）；還在用是 NULL。復原回來又用到就變回 NULL。
    unused_since TIMESTAMPTZ,
    PRIMARY KEY (flow_id, audio_id)
);
