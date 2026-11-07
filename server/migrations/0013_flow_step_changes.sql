-- 每一步改好之後的東西（#255，流程核心的 RemoteChange）：斷線重連時，把斷線期間別人的步照順序補給他。
-- 之前收的步沒記（NULL）：補不上，給伺服器現在的樣子。

ALTER TABLE flow_steps ADD COLUMN change JSON;
