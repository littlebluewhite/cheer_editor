-- 雲端流程的成功率紀錄（#257，ADR 0011）：跟編排分開存，一次一筆。編排（flows.content）裡每個動作的紀錄是空的，
-- 打開流程、伺服器跑一步時才放回去。

-- 全上：一次全上的 id（手機發的亂數）、日期、開的時間。
CREATE TABLE flow_run_throughs (
    flow_id TEXT NOT NULL REFERENCES flows (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    date TEXT NOT NULL,
    -- 開的時間（手機的時間，毫秒）；第 10 版以前的流程檔沒有。
    started_at BIGINT,
    PRIMARY KEY (flow_id, id)
);

-- 一次：手機發的 id、動作、組或隊員、記號、日期、全上 id、記的人。
CREATE TABLE flow_records (
    flow_id TEXT NOT NULL REFERENCES flows (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    -- 收到的先後：動作的紀錄照這個排。
    seq BIGSERIAL NOT NULL,
    action_id TEXT NOT NULL,
    -- 組 id；騰翻、跳躍是隊員 id。
    who TEXT NOT NULL,
    -- 環節 id → 記號（✓ △ ✗），照手機送來的字原樣存。
    marks JSON NOT NULL,
    whole BOOLEAN NOT NULL,
    -- 手機的當地日期，例：2026-11-04。
    date TEXT NOT NULL,
    -- 全上才有；分段練是 NULL。
    run_through_id TEXT,
    -- 記的人；從流程檔傳上來的紀錄沒有。
    recorded_by BIGINT REFERENCES users (id),
    -- 墓碑：被清掉（例：教練選清掉重算、刪掉動作）的時間。同一個 id 重送不會再加回來。
    deleted_at TIMESTAMPTZ,
    -- 最後改的時間。
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (flow_id, id)
);
CREATE INDEX flow_records_order ON flow_records (flow_id, seq);
