-- 刪除帳號（#369）：他在別人流程裡改過的步留著，不寫是誰（user_id 變 NULL），跟沒有記的人的紀錄一樣。
ALTER TABLE flow_steps ALTER COLUMN user_id DROP NOT NULL;
