# 復原時，這一步清掉的紀錄一起回來；重做再清一次

推翻 ADR 0006 裡「清掉的紀錄復原也救不回來」那部分。ADR 0006 的其他規則不變：紀錄還是存在流程裡，「記」還是不算復原的一步，復原、重做時照組 id 帶現在的紀錄，不問教練。

改的是這一點：刪環節、段縮短、刪動作、刪隊員、改名選「清掉重算」這類改動，會順便清掉紀錄或記號。以前復原只帶「現在的」紀錄，清掉的就不見了。現在復原時，這一步清掉的紀錄會一起回來；重做時再清一次。這一步做完之後才用「記」加的紀錄，復原、重做都還在；之後才用「記」刪掉的，復原也不會加回來。

做法：復原紀錄的每一步除了存改之前的流程，也存改之後的流程。比對這兩份，就知道這一步清掉了哪些紀錄、哪些記號（`recordsPatch`）。復原時先帶上現在的紀錄，再把這一步清掉的加回去（`undoRecords`）；重做時反過來，再清一次（`redoRecords`）。都是核心的純函式，存的是參照，不多佔空間。每次復原、重做完，這一步存的兩份流程換成剛剛真的換上的兩份：復原回來的紀錄在中間用「記」刪掉或改過，下次重做、復原照改過的算，不會拿最早存的紀錄蓋回去。

為什麼推翻：

- **數字會錯。** 整次成功率靠「這一次當時有沒有記號」判斷環節是不是當時就有。記號被清掉、環節卻被復原回來，這一次就被當成之後才加的環節，整次從 0% 變 100%（#233 實測的 N02）。
- **教練以為復原是全部回去。** 刪了有紀錄的動作，按「復原」，動作回來了，紀錄卻是空的，畫面也沒說（N25）。
- **大廠的做法是同一次操作的副作用一起復原。** Apple 的 UndoManager 預設把同一輪事件裡做的事合成一步復原："automatically creates undo groups around each pass of the run loop."、"The default is true."（[groupsByEvent](https://developer.apple.com/documentation/foundation/undomanager/groupsbyevent)）。刪環節時清掉的記號，跟刪環節是同一次操作。
- **復原的結果要能預期。** Apple HIG："Help people predict the results of undo and redo as much as possible."（[Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)）。Figma 的原則也一樣："if you undo a lot, copy something, and redo back to the present (a common operation), the document should not change."（[How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)）

## Considered Options

- **復原時把這一步清掉的紀錄加回來（選這個）**：數字對、復原的結果跟教練想的一樣。要多存改之後的流程，加一個比對紀錄的核心函式。
- **不救回紀錄，但復原時把「當時有、記號被清掉」的環節標成「不明」**：整次成功率不會算錯，改動最小。但教練按了復原，紀錄還是不見，跟「復原就是回到剛才」不一樣。
- **紀錄搬出流程**（ADR 0006 已經比較過）：要改所有讀紀錄的地方和流程檔格式。
- **照舊**：N02 的數字錯誤和 N25 的落差都留著。

## Consequences

- 確認框不再寫「紀錄救不回來」，改寫「清掉的紀錄按「復原」會回來」（`RECORDS_UNDOABLE`）。確認框留著，不照 Apple HIG 改成不問、做完給「已清掉・復原」的提示（"Avoid displaying alerts for common, undoable actions, even when they're destructive."，[Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)）：復原紀錄不存進檔案，關掉分頁、換流程以後就救不回來，所以還是先問（#233 決定，見 `docs/research/ux-root-causes.md`）。
- 確認框寫的次數照真的會不見的算：整筆不見的幾次（只剩空著的環節的那一次也算），和還在但少了記號的幾次，分開寫（N26）。
- 流程檔格式不變。復原紀錄不存進草稿或檔案，關掉分頁、換流程以後就沒有了，清掉的紀錄也一樣回不來。
- 用「記」刪掉上一次、刪掉某一次，還是不算復原的一步，照舊用「救回」。
