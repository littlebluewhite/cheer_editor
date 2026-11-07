-- 一起記全上（#262，ADR 0012）：同一次全上、同一個動作、同一組（騰翻、跳躍是同一個人）只算先存的那一筆。
-- 存的時候鎖著那支流程、先查過；這裡在資料庫再擋一道，沒清掉的只能有一筆。

-- 已經有兩筆以上的（這個限制之前存的）：留最早存的那筆，後面的清掉（留墓碑）。
UPDATE flow_records r
SET deleted_at = now(), updated_at = now()
WHERE r.run_through_id IS NOT NULL
  AND r.deleted_at IS NULL
  AND EXISTS (
      SELECT 1 FROM flow_records e
      WHERE e.flow_id = r.flow_id
        AND e.run_through_id = r.run_through_id
        AND e.action_id = r.action_id
        AND e.who = r.who
        AND e.deleted_at IS NULL
        AND e.seq < r.seq
  );

CREATE UNIQUE INDEX flow_records_one_per_run_squad
    ON flow_records (flow_id, run_through_id, action_id, who)
    WHERE run_through_id IS NOT NULL AND deleted_at IS NULL;
