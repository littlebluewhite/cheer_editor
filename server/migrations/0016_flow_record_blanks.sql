-- 一次的「空著的環節」（流程檔第 10 版的 blanks：整個做、中途 ✗ 時，那時就有、✗ 後面空著的環節 id）。
-- 沒有就是 NULL（沒有空著的）。照手機送來的原樣存。
ALTER TABLE flow_records ADD COLUMN blanks JSON;
