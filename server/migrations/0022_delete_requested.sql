-- 要求刪除帳號（#370）：使用者自己在帳號頁按的時間。同時停用；管理員按「恢復」清掉。管理使用者頁寫「要求刪除・日期」，不給移交。
ALTER TABLE users ADD COLUMN delete_requested_at TIMESTAMPTZ;
