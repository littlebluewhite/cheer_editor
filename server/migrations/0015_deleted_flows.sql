-- 刪掉的流程（#252）：刪的時候有權限的人（擁有者和名單上的人）。之後他們打開、連房間、看「我的流程」，
-- 說得出是「被擁有者刪掉了」，不是「被收回了」（斷線時、離線副本被刪掉的也看得出來）。
-- 本來就沒權限的人照舊跟沒有這支一樣（404）。
CREATE TABLE deleted_flows (
    flow_id TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users (id),
    deleted_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (flow_id, user_id)
);
CREATE INDEX deleted_flows_user ON deleted_flows (user_id);
