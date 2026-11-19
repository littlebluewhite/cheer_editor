-- 雲端流程收過的步（#248，ADR 0014）：第幾步、步驟 id、哪個分頁、誰。
-- 步驟 id 收過就回原本的結果，不套兩次。改到哪些東西、留 30 天在之後的票加。

CREATE TABLE flow_steps (
    flow_id TEXT NOT NULL REFERENCES flows (id) ON DELETE CASCADE,
    -- 收了這一步之後是第幾步。
    step BIGINT NOT NULL,
    step_id TEXT NOT NULL,
    tab_id TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (flow_id, step),
    UNIQUE (flow_id, step_id)
);
