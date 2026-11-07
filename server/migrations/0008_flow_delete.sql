-- 刪流程（#252）：流程刪了，它的音樂記下哪天不用了，30 天後才從 R2 真的刪（#266）。
-- 所以流程那一列刪掉時，音樂那幾列要留著：拿掉 flow_audio 跟著 flows 刪的外鍵。
ALTER TABLE flow_audio DROP CONSTRAINT flow_audio_flow_id_fkey;
