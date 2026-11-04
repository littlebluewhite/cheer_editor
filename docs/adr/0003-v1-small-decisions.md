# 第一版不做的幾件小事

規格（#15）的「地圖上沒討論到、開工時要先定的小事」列了四件。第一版這樣定：

- **復原（Undo／Redo）：2026-11 做了**，見 `docs/superpowers/specs/2026-11-03-formation-walk-design.md`。第一版沒做，因為刪東西都先確認、草稿自動存。
- **刪段、調段順序：第一版不做。** 只能在最後加段、改段的長度；要做時照「刪除要先確認」同一套，開頭那張站位跟著新的第一段（見 `docs/flow-file-format.md` 的「站位」）。
- **站位在時間上移動：2026-11 做了**，叫「挪站位」，見 `docs/superpowers/specs/2026-11-03-move-formation-design.md`。第一版只有插和刪。
- **位置的座標軸方向：已經定了**，寫在 `docs/flow-file-format.md` 的「位置座標」。
