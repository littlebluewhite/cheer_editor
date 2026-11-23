-- 雲端復原可以把那一步治好的舊毛病帶回來（ADR 0020）。
-- flows.held：這支流程現在讓它留著的毛病（整份流程檢查的鍵）；held_core：記的時候流程核心那包的指紋。
-- 傳上雲端、每收一步時寫；沒記過（部署前的流程、新建的）是 NULL，下一步重算。指紋不是現在的也重算。
ALTER TABLE flows ADD COLUMN held TEXT[], ADD COLUMN held_core TEXT;
-- flow_steps.cured：這一步治好的毛病（整份流程檢查的鍵），復原、重做這一步時可以帶回來。
-- 部署前收的步是 NULL：復原照以前的比法（只放過現在就有的）。
ALTER TABLE flow_steps ADD COLUMN cured TEXT[];
