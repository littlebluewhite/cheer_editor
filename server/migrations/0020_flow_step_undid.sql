-- 復原、重做的步復原了哪幾步（步驟 id：of 和算進來的 joined，ADR 0020）。
-- 方向鍵合成的一步復原時，joined 列的步已經被復原過的不算（不然那幾步治好的又能帶回來一次）。
-- 一般的步、這之前收的步是 NULL（當沒復原過什麼）。
ALTER TABLE flow_steps ADD COLUMN undid TEXT[];
