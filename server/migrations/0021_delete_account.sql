-- 刪除帳號（#369）：他在別人流程裡改過的步留著，不寫是誰（user_id 變 NULL），跟沒有記的人的紀錄一樣。
-- 不是「只加」，但部署時安全：遷移跑的時候舊版還在接流量，舊版只寫有 user_id 的步，只有新版刪帳號才寫 NULL，
-- 所以舊版這時看不到 NULL。倒回舊版的程式（有人刪過帳號之後）才看得到：舊版用 JOIN users 讀步，那些步讀不到——
-- 補上漏掉的步會改送整支流程（照常），送一步時比對的紀錄少了那些步。見 docs/deploy.md「資料表遷移」。
ALTER TABLE flow_steps ALTER COLUMN user_id DROP NOT NULL;
