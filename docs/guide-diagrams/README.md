# 使用說明的圖

`src/routes/guide/+page.svelte` 用的六張圖。這裡是原始檔（JSON），`src/lib/guide/*.svg` 是產生出來的圖。
用 fireworks-tech-graph skill（Style 1 Flat Icon）產生，改圖就改 JSON 再重新產生，不要直接改 SVG。

| JSON | 種類（mode） | 在說明的哪裡 |
| --- | --- | --- |
| `time.json` | `flowchart` | 2 先認識幾個詞：時間怎麼算 |
| `screen-map.json` | `architecture` | 2.2 畫面上的名稱：編輯畫面的四個區域 |
| `workflow.json` | `flowchart` | 3 排一支流程的八個步驟 |
| `walk.json` | `flowchart` | 4.5 站位：站位和走位 |
| `drag.json` | `flowchart` | 4.5 站位：拖人時改哪一張站位 |
| `files.json` | `data-flow` | 4.8 存檔、分享、列印 |

```sh
F=~/.claude/skills/fireworks-tech-graph/scripts/fireworks.py
python3 "$F" render flowchart docs/guide-diagrams/time.json src/lib/guide/time.svg
python3 "$F" check src/lib/guide/time.svg
```

圖上的字跟說明一樣，只用 `GLOSSARY.md` 的詞和畫面上的字。
