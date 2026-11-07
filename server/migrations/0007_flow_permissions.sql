-- 分享給使用者（#250）：一支流程、一個人、一種權限。擁有者記在 flows 上，不在這張表。
CREATE TABLE flow_permissions (
    flow_id TEXT NOT NULL REFERENCES flows (id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users (id),
    role TEXT NOT NULL CHECK (role IN ('editor', 'recorder', 'viewer')),
    -- 分享的時間：名單照加進來的順序排。
    added_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (flow_id, user_id)
);
-- 「分享給我的」。
CREATE INDEX flow_permissions_user ON flow_permissions (user_id);
