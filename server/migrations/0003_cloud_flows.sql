-- 雲端流程（#247）：擁有者、編排、現在第幾步、最後改的時間。
-- 分享連結、權限、步驟紀錄、紀錄在之後的票加。

CREATE TABLE flows (
    -- 12 個字的亂數（小寫字母、數字），放在網址、API 裡。
    id TEXT PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users (id),
    -- 編排（流程核心的 Flow，不含成功率紀錄，ADR 0008）。用 JSON 不用 JSONB：存進去的字照原樣拿出來。
    content JSON NOT NULL,
    -- 現在第幾步：剛建好是 0，收一步加 1（ADR 0011）。
    step BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX flows_owner ON flows (owner_id, updated_at DESC);
