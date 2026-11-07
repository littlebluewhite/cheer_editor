-- 分享連結（#251）：一支流程一條。關著是空的；開著存原本的字（擁有者要能再複製，所以不能只存雜湊）。
-- 關掉再打開換一條新的，舊的就找不到了。
ALTER TABLE flows ADD COLUMN share_token TEXT UNIQUE;
