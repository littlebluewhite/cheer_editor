-- 一次最後一次用「記」改、刪、救回時流程是第幾步（records.rs 的 amend）。跑一步、復原、重做改到的不算。
-- 復原、重做第 N 步時，N 步之後（含）用手動過的照現在的：內容一樣也算（例：刪掉再救回），不再清掉、換回去。
-- 沒用手動過是 NULL。
ALTER TABLE flow_records ADD COLUMN amended_step BIGINT;
