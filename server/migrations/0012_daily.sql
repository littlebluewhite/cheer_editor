-- 每天的工作（#266）算用量要的：備份多大、Neon 醒著多久。

-- 每天的備份（#265 放上 R2 後加一列）。R2 用量只算 30 天內的（備份 bucket 30 天自動刪）。
CREATE TABLE backups (
    taken_at TIMESTAMPTZ PRIMARY KEY,
    -- 位元組數（壓縮後）。
    size BIGINT NOT NULL
);

-- Neon 醒著多久（估的）：每次查詢後算醒著 5 分鐘，連著的算一段；一段結束時把秒數加到它開始的那個月（UTC）。
CREATE TABLE db_awake (
    -- 那個月的 1 號。
    month DATE PRIMARY KEY,
    seconds BIGINT NOT NULL
);
