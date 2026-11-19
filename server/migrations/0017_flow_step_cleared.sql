-- 每一步清掉、改掉的紀錄（ADR 0007、0014）：復原時把這一步清掉的加回來。
-- 一個陣列，每一筆是 { was: 改之前的那一次, now: 這一步之後的樣子（整筆清掉是 null） }（records.rs 的 Cleared）。
-- 沒清掉、沒改掉紀錄的步、之前收的步是 NULL（復原時沒有要加回來的）。

ALTER TABLE flow_steps ADD COLUMN cleared JSON;
