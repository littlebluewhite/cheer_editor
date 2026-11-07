-- 鎖住：密碼連續猜錯幾次（#246）。跟著 email 算（小寫），沒有帳號的 email 也記，
-- 這樣有沒有帳號回的話都一樣。登入成功、設好密碼、改好密碼就刪掉這一列。
CREATE TABLE login_failures (
    email TEXT PRIMARY KEY,
    failures INT NOT NULL,
    last_failed_at TIMESTAMPTZ NOT NULL
);
