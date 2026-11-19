-- 每一步改到哪些東西（#254，ADR 0014）：收到一步時查「上次看到之後，別的分頁有沒有改過同一個東西」。
-- 鍵見流程核心的 stepKeys（例：name、action:x7k2m9qa4b1z、pos:<站位 id>:<隊員 id>）。這張表留 30 天，清掉在 #266。
-- 之前收的步沒記，當成什麼都沒改到。

ALTER TABLE flow_steps ADD COLUMN keys TEXT[] NOT NULL DEFAULT '{}';
