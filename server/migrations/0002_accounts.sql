-- 帳號：使用者、設密碼連結、登入狀態（#244）。

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    -- PHC 字串（演算法、參數、鹽跟雜湊放在一起）；還沒設密碼是空的。
    password_hash TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    -- 停用的時間；沒停用是空的。
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 一個 email 一個帳號，不分大小寫。
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
-- 管理員只有一個。
CREATE UNIQUE INDEX users_one_admin ON users (is_admin) WHERE is_admin;

-- 設密碼連結（邀請、重設密碼）。只存 token 的 SHA-256；用掉、作廢就刪掉這一列。
CREATE TABLE password_links (
    token_hash BYTEA PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id),
    purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX password_links_user ON password_links (user_id);

-- 登入狀態。只存號碼的 SHA-256；到期時間是登入那天起 30 天，伺服器自己算。
CREATE TABLE sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
