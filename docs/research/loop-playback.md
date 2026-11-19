# 循環播放範圍與停止後播放頭的位置：現有編輯軟體怎麼做

研究紀錄，查核日期 2026-11-19。要回答三個問題：（1）使用者怎麼定一段範圍來循環播放、怎麼開關；（2）播放中按 Space 或 Stop，播放頭留在停下的地方，還是回到開始播放的地方；（3）有沒有第二個鍵或指令做另一種行為。只看廠商自己的手冊、說明頁、快捷鍵表。這裡只整理事實，不做決定。

標記方式：

- **已確認**：廠商手冊或官方說明頁有原文，下方附引文。
- **已確認（經摘要工具）**：原頁只能透過摘要工具讀，引文是工具回傳的句子，沒有逐字比對原頁。只有 Cubase 是這樣。工具沒回傳的事寫成「**經摘要工具查無**」：只代表工具讀的那一段沒有，不代表原頁沒寫。
- **部分確認**：有原文，但要靠推論才能套到問題上。推論會寫明「推論」。
- **未確認**：分兩種，會寫明是哪一種。「打不開」是官方頁回傳錯誤，沒讀到。「沒寫」是頁面有讀，但沒講這件事。

「查無」都指「在下方來源中查無」。快捷鍵照手冊原文寫，手冊只寫 Mac 鍵的就只有 Mac 鍵。版本寫在來源一節，行為會隨版本變。來源代號見文末。

看過的產品：Ableton Live、Cubase、Logic Pro、Pro Tools、REAPER、Audacity（音訊）；DaVinci Resolve、Final Cut Pro（影片）；Transcribe!、Amazing Slow Downer、VLC（練習用播放器）。Premiere Pro、Anytune 的官方頁打不開。

## 結論

1. **循環範圍有四種定法，多數產品不只支援一種。**（a）在時間尺上拖出一段獨立的範圍：Ableton、Logic、Cubase、Audacity、REAPER。（b）直接用目前的選取：Pro Tools、Transcribe!、Final Cut Pro。（c）用 I、O 鍵設 In、Out 點：Final Cut Pro、DaVinci Resolve。（d）播放中點按鈕標起點、再點一次標終點：Transcribe!、Amazing Slow Downer、VLC for Android。已確認（Cubase 經摘要工具）。
2. **循環的開關是獨立的一個切換，和範圍分開。** 各家快捷鍵不同：Ableton Ctrl+L／Cmd+L、Logic C、Cubase Num /、Pro Tools Command+Shift+L（Mac）、REAPER R、Audacity L、Resolve Command-/、Final Cut Pro Command-L。Logic 寫明關掉 Cycle 後 cycle area 變成灰色，還留著；Audacity 清除範圍是另一個指令 Clear Loop。已確認（Cubase 經摘要工具）。
3. **在尺上拖出範圍會自動打開循環的有 Logic 和 Audacity。** Audacity 另外寫明「不會開始播放」。已確認。
4. **有範圍、循環也開著，按 Space 不一定循環那一段。** Resolve 寫明 In、Out 點不會觸發循環，要用 Play In to Out。Final Cut Pro 手冊寫循環整個專案按 Space，循環一段按 /（Play Selection）。已確認。
5. **播放頭在範圍外時按播放，各家做法不同，而且多半可以改。** Logic 在 Cycle 開著時從 left locator 開始。Cubase 用 Start Mode 選從游標或從 cycle 起點開始。Ableton 預設從 insert marker 開始，可以改成從 loop brace 起點。Pro Tools 的 Dynamic Transport 用另一個 Play Start Marker 決定起點。Transcribe! 可以從範圍前面開始播，播到範圍就開始循環。已確認（Cubase 經摘要工具）。Pro Tools 從範圍外開始播之後會怎樣，手冊只在「播放中改選取」的情境寫到：播放頭在新範圍前面，進入範圍後就循環；在新範圍後面，不會跳回去。套到「從範圍外按播放」是推論，**部分確認**。REAPER、Audacity、Final Cut Pro、Resolve、Amazing Slow Downer、VLC **未確認（沒寫）**。
6. **停止後預設回到開始位置的**：REAPER、Audacity、Transcribe!、Ableton。REAPER 寫播放游標「回到」起點；Audacity、Transcribe!、Ableton 寫的是「下次播放從原來的起點開始」。已確認。
7. **用一個開關切換「回去」或「留下」的**：Cubase 的 "Return to Start Position on Stop"、Pro Tools 的 "Timeline Insertion/Play Start Marker Follows Playback"、DaVinci Resolve 的 "Stop and Go to Last Position"。已確認（Cubase 經摘要工具）。預設是開還是關：Pro Tools、Resolve **未確認（沒寫）**；Cubase **經摘要工具查無**。
8. **停止留在原地、回去要另外下指令的**：Logic Pro。Stop 按第二下才回到專案開頭（Cycle 開著時回到 left locator）；另有 "Stop and Go to Last Locate Position" 等 key commands，可以指定給 Stop 按鈕。原文已確認；「第一下留在原地」是從「第二下才移動」推得，**部分確認**。
9. **預設會回去的四個產品，都另外給「從停下的地方繼續」的鍵或指令。** REAPER：Pause（Enter），以及 action "Transport: Play/stop (move edit cursor to stop)"。Audacity："Play/Stop and Set Cursor"（X）和 Pause（P）。Ableton："Continue Play from Stop Point"（Shift+Space）。Transcribe!：逗號或分號鍵 un-pause、"PlayResume" 指令、E 鍵。已確認。
10. **Resolve 開了 "Stop and Go to Last Position" 之後，同時有兩個鍵**：K 讓播放頭停在原地，Space 回到開始位置。已確認。
11. **手冊沒寫停止後播放頭在哪裡的**：Final Cut Pro（指令叫 Play/Pause，另有 Stop 是 K）、VLC（Play/Pause 是 Space，Stop 是 s）、Amazing Slow Downer（只有 "Rewind on Stop" 設定）。**未確認（沒寫）**。
12. **Premiere Pro、Anytune 三個問題都未確認（打不開）。** helpx.adobe.com 和 anytune.zendesk.com 都回傳 HTTP 403。

## 1. 循環範圍：怎麼定、怎麼開關

### 各產品對照

| 產品 | 範圍怎麼定 | 設起點、終點的鍵或手勢 | 循環開關 | 播放頭在範圍外按播放 | 狀態 |
|---|---|---|---|---|---|
| Ableton Live 12 | 時間尺上的 loop brace，和選取分開 | 拖 brace 左右邊；Set Loop Brace Start（Ctrl+F10／Cmd+F10）、Set Loop Brace End（Ctrl+F11／Cmd+F11）；Loop Selection 把選取變成範圍（Ctrl+L／Cmd+L） | Control Bar 的切換鈕；Ctrl+L／Cmd+L | 預設從 insert marker 或選取開始；brace 右鍵選單 "Set Song Start Time Here" 改成從 brace 起點開始 | 已確認 |
| Cubase Pro 15 | 尺上方的 left／right locator | 在尺的上半部拖；選取後按 P；雙擊 cycle marker；Ctrl／Cmd+Num 1、Num 2 把 locator 設到游標 | 點尺上的 locator 範圍，或 Activate Cycle；Num / | 由 Transport 選單的 Start Mode 決定：從游標，或從 left locator | 已確認（經摘要工具） |
| Logic Pro | 尺上方的 cycle area（left／right locator） | 在尺的上半部左右拖；拖 cycle area 的邊；Shift 點尺；Command-U 用選取設 locator | Cycle 按鈕或 C；點尺上的 cycle area。拖出範圍會自動打開 | Cycle 開著時從 left locator 開始 | 已確認 |
| Pro Tools 2024.10 | 目前的 timeline 選取，至少 500 ms | 用 Selector 工具選一段 | Options > Loop Playback；Command+Shift+L（Mac）／Control+Shift+L（Windows）；數字鍵 4；Control 點或右鍵點 Play | 一般模式從選取（或 pre-roll）開始。Dynamic Transport 模式用 Play Start Marker 另外定起點。從範圍外開始之後會怎樣，只在「播放中改選取」的情境有寫 | 已確認；範圍外開始之後的行為**部分確認**（推論） |
| REAPER 7.86 | 在 timeline 上拖出 loop，可設定和 time selection 連動 | 在 timeline 上拖；拖 loop 邊緣調整；Ctrl 加雙擊 item；Esc 清除 | transport 的 Toggle Repeat 按鈕；R | 查無 | 已確認；範圍外**未確認（沒寫）** |
| Audacity 3.7 | Timeline 上的 looping region，預設和選取分開 | 在 Timeline 上拖；拖 in、out 點；Set Loop to Selection（Shift+L）；Set Loop In、Set Loop Out（沒有預設鍵） | Loop 按鈕；L。拖出範圍會自動打開，但不會開始播放 | 查無 | 已確認；範圍外**未確認（沒寫）** |
| DaVinci Resolve 20 | In、Out 點，搭配 Play In to Out 指令 | I、O 鍵 | Loop 按鈕；Playback > Loop/Unloop；Command-/ | 查無。一般 Play 不理 In、Out 點 | 已確認；範圍外**未確認（沒寫）** |
| Final Cut Pro | range 選取 | I、O 鍵；Range Selection 工具（R）拖；拖 range 兩邊的把手 | View > Playback > Loop Playback；Command-L | 查無。手冊寫循環一段用 /（Play Selection），循環整個專案用 Space | 已確認；範圍外**未確認（沒寫）** |
| Transcribe! | 波形上的選取；可存成 stored loop | 滑鼠在波形上拖；拖選取的一端；播放中按 "A-B Loop" 按鈕兩下 | Play 選單的 "Loop"，預設開著 | Control 點（Mac 是 Command 點）波形可從範圍前面開始，播到範圍就循環 | 已確認 |
| Amazing Slow Downer（iOS、Android） | 兩個 loop point 滑桿 | 拖滑桿；播放中點滑桿右邊的 "Set" 按鈕；"1/2"、"x2" 改長度；左右箭頭整段平移 | "Loop" 開關 | 查無。快轉、倒轉只能在起點和終點之間 | 已確認；範圍外**未確認（沒寫）** |
| VLC for Android 3.X | A-B repeat 兩個標記 | 點 SET START POINT，再點 SET END POINT | 設完終點就開始循環；另有按鈕清除標記、關閉 A-B repeat | 查無 | 已確認；範圍外**未確認（沒寫）** |
| VLC 桌面版 3.0 | 查無 | 查無 | 查無 | 查無 | **未確認（沒寫）**：讀過的 Hotkeys、Playback 兩頁沒提 A-B loop |
| Premiere Pro | — | — | — | — | **未確認（打不開）** |
| Anytune | — | — | — | — | **未確認（打不開）** |

### 原文

| 來源 | 原文 | 狀態 |
|---|---|---|
| [Ableton：Arrangement View][ableton-arr] 6.6 | "To repeatedly play a section of the Arrangement, activate the Arrangement Loop using the toggle in the Control Bar." | 已確認 |
| 同上 | "The Loop Selection command in the Edit menu can be used to turn on the Arrangement loop and set the loop brace to the current time selection."（接著寫快捷鍵是 Ctrl+L／Cmd+L，選了 clip 或時間時也用來開關循環） | 已確認 |
| 同上 | "You can also drag the loop brace: dragging from the left or right edge adjusts the loop start/end points, while dragging the brace bar horizontally moves the loop without changing its length." | 已確認 |
| 同上 | "You can set the loop length numerically using the Loop Start and Loop Length fields in the Control Bar, which determine the loop start position and loop length, respectively." | 已確認 |
| 同上 | "The left and right arrow keys nudge the loop brace to the left or right based on the current grid settings."；"The up and down arrow keys shift the loop brace left or right in steps based on the loop brace length."；Ctrl（Win）／Cmd（Mac）加上下鍵："doubles or halves the loop length." | 已確認 |
| 同上 | "To trigger playback from the loop brace’s starting point, enable the Set Song Start Time Here command in the brace’s context menu. This command overrules the default behavior, which triggers playback at the insert marker or active time selection." | 已確認 |
| [Ableton：快捷鍵][ableton-keys] 42.8 | 表列 "Set Loop Brace Start"（Ctrl+F10／Cmd+F10）、"Set Loop Brace End"（Ctrl+F11／Cmd+F11）、"Toggle Loop Brace"（Ctrl+L／Cmd+L） | 已確認 |
| [Cubase：Left and Right Locators][cubase-loc] | "The left and right locators are a pair of markers that you can use as reference positions" | 已確認（經摘要工具） |
| 同上 | "To activate/deactivate cycle mode, click the locator range in the upper part of the ruler" | 已確認（經摘要工具） |
| [Cubase：Setting up Locator Ranges][cubase-range] | "Click and drag in the upper part of the ruler."；"Select a range or an event, and press P to set the locators to the selection."；"Double-click a cycle marker." | 已確認（經摘要工具） |
| [Cubase：Transport Menu][cubase-tm] | Start Mode 底下："Start from Project Cursor Position"："If activated, playback starts from the current project cursor position."；"Start from Cycle Start"："If activated, playback starts from the left locator." | 已確認（經摘要工具） |
| 同上 | "Loop Selection"："Sets the locators to encompass the current selection, and starts playback at the start of the selection and keeps starting over again at the selection end." | 已確認（經摘要工具） |
| [Cubase：Transport 類快捷鍵][cubase-keys] | 表列 Cycle：Num /；Locators to Selection：P；Loop Selection：Alt/Opt-P；Go to Left Locator：Num 1；Set Left Locator to Project Cursor Position：Ctrl/Cmd-Num 1；Set Right Locator to Project Cursor Position：Ctrl/Cmd-Num 2 | 已確認（經摘要工具） |
| [Logic：Use the cycle area][logic-cycle] | "Click the Cycle button in the control bar (or press C)."；"Click the cycle area in the upper part of the ruler." | 已確認 |
| 同上 | "When Cycle mode is turned off, the cycle area (and the locators) change to gray." | 已確認 |
| 同上 | "In Logic Pro, drag left or right in the upper part of the ruler."；"The cycle area appears as a yellow strip in the ruler, and Cycle mode is automatically turned on." | 已確認 |
| 同上 | "Grab the left or right edge of the cycle area to move the start or end point."；"Shift-click a position in the ruler." | 已確認 |
| 同上 | "Set Locators/Loop by Regions/Events/Marquee: Sets the locators at the start and end points of the selected regions or events, or the marquee selection (default: Command-U)." | 已確認 |
| 同上 | LCD 的 locator 欄位："Double-click the left or right locator position, then enter a new position."；平移："Move Locators Forward by Cycle Length (or press Shift-Command-.)." | 已確認 |
| [Logic：Control playback][logic-transport] | "Play button: Starts playback at the playhead position, or from the left locator position when in Cycle mode." | 已確認 |
| [Pro Tools Reference Guide][pt] Loop Playback Mode，第 657 頁 | "When Loop Playback mode is enabled, the selected track range repeats on playback. If there is no selection, playback occurs normally from the current Cursor location." | 已確認 |
| 同上 | "A selection must be at least 500 ms in length for it to loop on playback." | 已確認 |
| 同上 | 開啟方式逐條列出："Select Options > Loop Playback."；"Right-click the Play button in the Transport window and select Loop from the pop-up menu."；"Press Command+Shift+L (Mac) or Control+Shift+L (Windows)."；"With the Numeric Keypad mode set to Transport, press 4 on the numeric keypad." | 已確認 |
| 同上 | "Playback begins from the pre-roll point (if enabled) and continues to the selection’s end point, where it loops back to the selection’s start point." | 已確認 |
| 同上，Dynamic Transport Mode | "Dynamic Transport mode lets you decouple the playback location from the Timeline selection. This means that you can start playback from anywhere on the Timeline without losing your Timeline or Edit selections." | 已確認 |
| 同上 | "The Play Start Marker determines where playback starts when the Transport is engaged." | 已確認 |
| 同上，第 660 至 661 頁 | 把 Play Start Marker 放在範圍終點之前再播放："Playback starts before the loop end point and continues across the loop point through the loop start." | 已確認 |
| 同上，第 660 頁，播放中改選取、且 "Dynamic Transport Follows Timeline Selection During Playback" 關掉時 | "If a new Timeline Selection is made during playback that is later than the current location of the Playhead, the Playhead continues uninterrupted without jumping to the start of new selection."；"If the Playhead enters the new selection, it loops playback between the loop points of the selection." | 已確認（只講播放中改選取的情境） |
| 同上 | "If a new Timeline Selection is made before the location of the Playhead during playback, the Playhead continues uninterrupted without jumping back to the start of the new selection. You will need to manually relocate the Playhead to the new timeline selection to loop playback within the selection boundaries." | 已確認（只講播放中改選取的情境） |
| [REAPER User Guide][reaper] 2.17 | "Either way, to define a loop area click and drag along the timeline. The start and end of the loop are marked by two small equilateral triangular indents." | 已確認 |
| 同上 | "Now when you play the project, provided that the loop (toggle repeat) button on the transport bar is engaged, it will replay over again the area selected for your Loop." | 已確認 |
| 同上 | "Pressing the R key toggles this repeat function on and off."；"To clear the loop altogether, without defining a new one, press the Escape key." | 已確認 |
| 同上 | "first check the Options menu to see if Loop Points Linked to Time Selection is enabled. If it is, then making a time selection and defining a loop are the same thing. If not, then making a time selection and defining a loop become two different things." | 已確認 |
| 同上，2.17、2.18 | "Tip: To set the loop selection to match a media item, hold Ctrl while you double click on that item."；"To modify a loop selection using the mouse, hover the mouse over the edge at the start or finish of the loop selection on the timeline, then click and drag left or right." | 已確認 |
| [Audacity：Timeline][aud-timeline] | "Left-click + drag creates a new looping region, or moves the current looping region around."；"You can drag the in point, out point, as well as the entire looping region to different points in the timeline." | 已確認 |
| [Audacity：Playback][aud-playback] | "Click and drag in the timeline to set a looping region without moving the waveform region or cursor and without having to stop and restart playback."；"Doing this will automatically turn looping on (the Loop button will be shown down) - but it will not start loop play." | 已確認 |
| [Audacity：Transport Toolbar][aud-toolbar] | "Toggles looping on/off. While turned on, pressing play will cause the looping region to play in loop mode."；"When no looping region is present, the current selection is converted to a looping region." | 已確認 |
| [Audacity：Transport Menu: Looping][aud-looping] | "Set Loop In"："Sets the start point of the looping region in the Timeline."；"Set Loop Out"："Sets the end point of the looping region in the Timeline." | 已確認 |
| [Audacity：快捷鍵表][aud-keys] | 表列 Loop on/off：L；Clear Loop：Shift+Alt+L；Set Loop to Selection：Shift+L；Set Loop In、Set Loop Out：(unassigned)；Play Once/Stop：Shift+Space，"Plays the looping region only once when looping is enabled." | 已確認 |
| [Audacity：Timeline][aud-timeline] 右鍵選單 | "Setting a loop region also makes an audio selection: When disabled (default), left-click and dragging the looping region adjusts the looping region only, leaving the current selection or editing cursor unaffected." | 已確認 |
| [DaVinci Resolve 20 手冊][resolve] 第 33 章，Edit 頁的 viewer | "Loop Playback: Enables or disables looped playback. Looping is also controllable via the Playback > Loop/Unloop command (Command-/). When enabled, each playback command loops back to the beginning when the end of that command’s range is reached. In and Out points in the Source or Timeline Viewers do not trigger looping." | 已確認 |
| 同上，第 35 章，第 729 至 730 頁 | "Loop: Command-Forward Slash (/). Toggles looped playback off and on. While looped playback is on, playback initiated with any of the following commands will loop automatically until you stop playback." | 已確認 |
| 同上 | "Play In to Out: Option-Forward Slash (/). If you’ve marked a section of a clip or timeline with In and Out points, this command lets you preview how it will play." | 已確認 |
| 同上，Fairlight 頁 | "Loop: Toggles looped playback off and on. While looped playback is on, playback will loop at the end of the Timeline, and will also loop when you use the Play In to Out command, and will continue to loop automatically until you stop playback." | 已確認 |
| 同上，Cut 頁 | "These In and Out points can also be set using the I and O keys." | 已確認 |
| [Final Cut Pro：Play media][fcp-play] | "To turn on looping in Final Cut Pro, choose View > Playback > Loop Playback (or press Command-L)." | 已確認 |
| 同上 | "Loop your entire project: Click the timeline to make it active, then press the Space bar." | 已確認 |
| 同上 | "Loop a portion of a clip or project: Select a range in a browser clip or the timeline (or select a timeline clip), then choose View > Playback > Selection, or press the Slash (/) key." | 已確認 |
| [Final Cut Pro：Select ranges][fcp-ranges] | "Use the I and O keys to set the range selection start and end points."；"Click the Tools pop-up menu in the top-left corner of the timeline and choose Range Selection (or press R)."；"To adjust the range selection start and end points, drag the range handles on either side of the range." | 已確認 |
| [Transcribe! FAQ][ts-faq] 第 15 題 | "On the "Play" menu, make sure that "Loop" is selected - in fact this is the default anyway, as long as you haven't changed it." | 已確認 |
| 同上 | "Select the section you want to loop - that is, sweep the mouse over the waveform display with the button pressed, so the desired section is selected (highlit)." | 已確認 |
| 同上 | "You can also do it while playing by pressing the "A-B Loop" button on the toolbar : once to set the loop start point and then again to select the loop end." | 已確認 |
| 同上，第 12 題 | "To adjust one end of an existing selection : click and drag, near the end you want to adjust. You can also use the arrow keys, for details see the Help for Keyboard Shortcuts (Application or File menu)." | 已確認 |
| 同上，第 18 題 | "You can control-click (command-click on Mac) on the waveform at the required start point."；"If you have selected a section for looping and then use this technique to start playback before the loop then when playback reaches the loop, it will loop that section." | 已確認 |
| 同上，第 16 題 | "You can store and recall any number of loops, on the Misc page of the Fx window." | 已確認 |
| [Amazing Slow Downer iOS 手冊][asd-ios]（[Android 手冊][asd-android] 同文） | "If you enable the "Loop" switch, the current song will loop between the set loop points. You can enter new loop positions by moving the sliders or by tapping the "Set" buttons located to the right of the corresponding slider." | 已確認 |
| 同上 | "The "Set" buttons are especially useful while the audio is playing through."；"By tapping AND holding down the "Set" buttons for a short moment, a "Trim Loops" view will appear which lets you fine adjust the loop points." | 已確認 |
| 同上 | "You can slide the set loop forwards or backwards with the same amount as the current loop length by tapping the left/right arrow buttons."；"You can half or double the loop length by tapping the "1/2" and "x2" buttons." | 已確認 |
| 同上（iOS 手冊） | "Tapping the "Manage Loops" button to the right of the "Loop" switch allows you to name and store as many loops as you want and then recall any of them at a later time." | 已確認 |
| 同上 | "Note that you can only forward/rewind between the selected start and end points."；設定項 ""Forward/Rewind May Extend Loop" will extend the loop when you tap the forward or rewind buttons and the new position is outside of the set loop." | 已確認 |
| 同上 | 設定項 "Select what will happen when playback reaches the loop end point - "Wait Between Loops"."，可選立刻重來、等幾秒、等一個循環的長度 | 已確認 |
| [VLC for Android：Video Player][vlc-android-video]（[Audio Player][vlc-android-audio] 同一段，video 換成 audio） | "A-B repeat - A-B repeat is to loop a video between two points." | 已確認 |
| 同上 | "Now tap … SET END POINT to set an end marker … at the time you want to end this repeat. Once set the A-B repeat will start."；"Tap on … to remove markers."；"Tap on … to close A-B repeat"（「…」是原頁的圖示） | 已確認 |

補充：

- Pro Tools 的範圍就是選取，手冊的步驟第一步是 "Select Options > Link Timeline and Edit Selection."。打開 Dynamic Transport 會自動關掉這個連動，並自動打開 Loop Playback（"Enabling Dynamic Transport mode automatically disables Link Timeline and Edit Selection, and automatically enables Loop Playback mode."）。已確認。
- Transcribe! 第 20 題另有 "PlayLoopRelease" 指令：循環中不改選取，讓播放繼續到曲尾。已確認。
- Resolve 的 Play In to Out 遇到循環會不會重複，Edit 頁那一條只寫「以下指令會自動循環」，Fairlight 頁那一條明寫 Play In to Out 會循環。已確認。

## 2. 按 Space 或 Stop 之後，播放頭在哪裡

### 各產品對照

| 產品 | 按 Space 或 Stop 之後 | 是預設、開關，還是另一個指令 | 設定或指令的名稱 | 狀態 |
|---|---|---|---|---|
| REAPER 7.86 | 播放游標回到開始播放的位置 | 預設 | Stop（Spacebar） | 已確認 |
| Audacity 3.7 | 編輯游標和選取不變，下次播放從上次的起點開始 | 預設 | "Play/Stop"（Space） | 已確認 |
| Transcribe! | 再按一次 Space，從 current point（紅色三角形）重新播放 | 預設 | Space；從 current point 開始播的指令叫 "PlaySpacebar" | 已確認 |
| Ableton Live 12 | 再按 Space，從 insert marker 開始，不是從停下的地方 | 預設 | "Play from Start Marker/Stop"（Space） | 已確認。停下那一刻播放頭畫在哪裡，**未確認（沒寫）** |
| Cubase Pro 15 | 開關打開時，project cursor 回到開始位置 | 開關，在 Transport 選單（Start Mode 一組） | "Return to Start Position on Stop" | 已確認（經摘要工具）。預設開或關**經摘要工具查無** |
| Pro Tools 2024.10 | 打開時，insertion 和 Play Start Marker 移到停下的地方；關掉時回到開始播放的地方 | 開關，在 Operation 偏好設定、Options 選單、Edit 視窗工具列；Control+N（Mac）／Start+N（Windows） | "Timeline Insertion/Play Start Marker Follows Playback"；選單上叫 "Insertion Follows Playback" | 已確認。預設開或關**未確認（沒寫）** |
| DaVinci Resolve 20 | 模式打開時，播放頭回到開始播放的地方 | 開關，在 Playback 選單，或右鍵點 Stop 按鈕 | "Stop and Go to Last Position" | 已確認。模式關掉時留在原地是推論，**部分確認**；預設開或關**未確認（沒寫）** |
| Logic Pro | Stop 第一下停止；第二下才把播放頭移到專案開頭，Cycle 開著時移到 left locator。注意：Cycle 開著時，下次 Play 是從 left locator 開始（見第 1 節引文），不是從停下的地方 | 預設是留下（推論）；回去是第二下或另外的指令 | Stop 按鈕；"Play or Stop"（Space bar） | 原文已確認；「第一下留在原地」是推論，**部分確認** |
| Final Cut Pro | 查無 | — | "Play/Pause"（Space bar）；"Stop"（K） | **未確認（沒寫）** |
| Amazing Slow Downer | 查無。可設定每次按 Stop 自動倒回一點 | 設定 | "Rewind on Stop" | 設定已確認；停下的位置**未確認（沒寫）** |
| VLC 桌面版 3.0 | 查無 | — | "Play/Pause"（Space）；"Stop"（s） | **未確認（沒寫）** |
| Premiere Pro | — | — | — | **未確認（打不開）** |
| Anytune | — | — | — | **未確認（打不開）** |

### 原文

| 來源 | 原文 | 狀態 |
|---|---|---|
| [REAPER User Guide][reaper] 2.15 Managing the Play Cursor | "By default, when a project is playing, pressing Stop (or Spacebar) will stop playback and return the play cursor to its previous starting position. Pressing Pause (or Enter) will pause playback at the current play cursor position." | 已確認 |
| 同上，2.3 The Transport Bar | "The Stop button stops playback and returns the play cursor to the position it was in when playback started. The Pause button pauses playback without moving the play cursor." | 已確認 |
| [Audacity：Transport Menu: Playing][aud-playing] Play/Stop | "When there is already playback or recording (or playback or recording is paused), this command stops playback or recording immediately without changing the selection region or the position of the editing cursor. Therefore using any play or record command after stopping with "Play/Stop" will start playback or recording from the same Timeline position it last started from." | 已確認 |
| [Audacity：Playback][aud-playback] | "The shortcut Space can be used to either play or stop. After stopping, playback resumes from its last starting point." | 已確認 |
| [Transcribe! FAQ][ts-faq] 第 11 題 | "After you pause playback with the spacebar, if you press the spacebar again you will play again from the current point (the little red triangle)." | 已確認 |
| 同上，第 13 題 | "they just indicate the current point, which is where playback will begin if you press the Play button or the spacebar." | 已確認 |
| 同上，第 11 題 | "If you do this then it might make sense to program some other keystroke to trigger "PlaySpacebar" as it can be useful to have a keystroke which starts playback from the current point." | 已確認 |
| [Ableton：Arrangement View][ableton-arr] | "You can click the Play button to start playback; to stop playback, click the Stop button. Alternatively, you can use the space bar to toggle playback on or off." | 已確認 |
| 同上 | "The flashing blue insert marker on a track determines where playback starts." | 已確認 |
| 同上 | "To continue playback from where it last stopped, rather than from the insert marker, hold Shift while pressing the space bar." | 已確認 |
| [Cubase：Transport Menu][cubase-tm] | "Return to Start Position on Stop"："If activated, the project cursor returns to its start position when playback is stopped." | 已確認（經摘要工具） |
| [Pro Tools Reference Guide][pt] Operation Preferences，Transport | "Timeline Insertion/Play Start Marker Follows Playback"："When selected, the Timeline Insertion and the Play Start Marker both move to the point in the Timeline where playback stops. When deselected, the Timeline Insertion and Play Start Marker do not follow playback, but return to the location where playback began." | 已確認 |
| 同上 | "Press Control+N (Mac) or Start+N (Windows) to toggle the Timeline Insertion/Play Start Marker Follows Playback preference on and off." | 已確認 |
| 同上，第 652、660 頁 | "Enable the Timeline Insertion/Play Start Marker Follows Playback button in the Edit window."；"You can enable or disable the Timeline Insertion/Play Start Marker Follows Playback option in the Operation Preferences."；"Select Option > Insertion Follows Playback."（"Option" 照原文） | 已確認 |
| 同上，Transport 視窗 Stop | "You can also stop the transport by pressing the Spacebar, or with the Numeric Keypad mode set to Transport, pressing 0." | 已確認 |
| [DaVinci Resolve 20 手冊][resolve] 第 35 章，第 731 頁 | "Playback > Stop and Go to Last Position lets you set DaVinci Resolve to a mode where the playhead returns to where playback began whenever you stop. This option is most useful when editing audio, although it’s available any time." | 已確認 |
| 同上 | "This option is also available when you right-click on the Stop button in the transport controls of any viewer. A contextual menu appears where you can turn “Stop and go to last position” on or off as the default behavior." | 已確認 |
| 同上，第 727 頁 | "Spacebar: You can use the Spacebar to start and stop playback." | 已確認 |
| [Logic：Control playback][logic-transport] | "Stop button: Stops playback or recording. Click a second time to move the playhead to the start of the project, or to the left locator position when in Cycle mode. Right-click for more stop options." | 已確認 |
| [Logic：Use transport key commands][logic-keys] | "Play or Stop: Starts or stops playback. Press the Space bar." | 已確認 |
| [Final Cut Pro：Play media][fcp-play] | "Stop playback: Press the Space bar." | 已確認 |
| [Final Cut Pro：快捷鍵][fcp-keys] | 表列 "Start or pause playback"：Play/Pause：Space bar；"Stop playback"：Stop：K | 已確認 |
| [Amazing Slow Downer iOS 手冊][asd-ios]（[Android 手冊][asd-android] 同文） | "It's possible to automatically rewind a bit whenever the Stop button is tapped (Settings - Rewind on Stop)." | 已確認 |
| [VLC 桌面版：Hotkeys][vlc-hotkeys] | 表列 Play/Pause：Space；Stop：s | 已確認 |

補充：

- Ableton 沒有寫「停止後播放頭回到開始位置」這句話。它寫的是播放從 insert marker 開始，以及 Shift+Space 才從停下的地方繼續。所以「再按 Space 會從 insert marker 重來」是已確認；「停下時播放頭跳回去」**未確認（沒寫）**。
- Final Cut Pro 把 Space 的指令叫做 Play/Pause，說明是 "Start or pause playback"。推論：pause 表示留在原地。但手冊沒有直接寫播放頭的位置，**未確認（沒寫）**。
- Amazing Slow Downer 的 "Rewind on Stop" 是「倒回一點點」（"rewind a tiny bit"），不是回到開始位置。推論：不開這個設定時，Stop 留在原地。但手冊沒有直接寫，**未確認（沒寫）**。

## 3. 有沒有另一個鍵做另一種行為

### 各產品對照

| 產品 | 「停在這裡／從這裡繼續」 | 「停下並回去」 | 狀態 |
|---|---|---|---|
| REAPER 7.86 | Pause（Enter）；action "Transport: Play/stop (move edit cursor to stop)"，手冊寫要自己指定按鍵，舉例 Shift Space | Stop（Spacebar），預設 | 已確認 |
| Audacity 3.7 | "Play/Stop and Set Cursor"（X）；"Pause"（P） | "Play/Stop"（Space），預設 | 已確認 |
| Ableton Live 12 | "Continue Play from Stop Point"（Shift+Space）；"Move Insert Marker to Playhead Position"（Ctrl+Shift+Space／Cmd+Shift+Space） | "Play from Start Marker/Stop"（Space），預設；雙擊 Stop 或 Home 把 insert marker 移回開頭 | 已確認 |
| Transcribe! | un-pause：逗號或分號鍵，或下方工具列的 pause 按鈕；"PlayResume" 指令可指定給 Space；E 鍵把 current point 設到目前播放或暫停的位置 | Space，預設 | 已確認 |
| DaVinci Resolve 20 | 模式打開時：K | 模式打開時：Space。另有 "Play Again"（Option-L），不停下直接從開始位置重播 | 已確認 |
| Logic Pro | "Stop or Play from Last Position"；Pause 按鈕（要自己加到 control bar） | Stop 第二下；"Stop and Go to Last Locate Position"；"Play or Stop and Go to Last Locate Position"；"Stop and Go to Left Locator"；"Stop and Go to Beginning"。多數沒有預設鍵，可指定給 Stop 按鈕 | 已確認 |
| Cubase Pro 15 | 查無第二個指令。只有開關 | 查無第二個指令。只有開關 | **經摘要工具查無**：工具回傳的 Transport 選單項目和 Transport 類快捷鍵沒有這類指令 |
| Pro Tools 2024.10 | 查無第二個指令。只有開關（Control+N／Start+N） | 同左 | **未確認（沒寫）** |
| Final Cut Pro | 有 Play/Pause（Space bar）和 Stop（K）兩個指令，手冊沒寫兩者差在哪 | 同左 | **未確認（沒寫）** |
| VLC 桌面版 3.0 | 有 Play/Pause（Space）和 Stop（s）兩個熱鍵，文件沒寫兩者差在哪 | 同左 | **未確認（沒寫）** |
| Amazing Slow Downer | 有 Play/Stop 和 Rewind 兩個按鈕，手冊沒寫 Rewind 回到哪裡 | 同左 | **未確認（沒寫）** |
| Premiere Pro、Anytune | — | — | **未確認（打不開）** |

### 原文

第 2 節已引的不重複。

| 來源 | 原文 | 狀態 |
|---|---|---|
| [REAPER User Guide][reaper] 12.15 Play/Stop Cursor Options | "By default, when you use the spacebar to start/stop playback, then on stopping the play cursor will return to join the edit cursor at the position it was at when playback started. However, you also have an option to instead leave the play cursor at its stop position when playback stoops, and to move the edit cursor forward to meet it."（"stoops" 是原文的錯字） | 已確認 |
| 同上 | "Open the Actions List and find the action Transport: Play/stop (move edit cursor to stop). This can be assigned to a combination of your choice (e.g. Shift Space)." | 已確認 |
| [Audacity：Transport Menu: Playing][aud-playing] | "Play/Stop and Set Cursor X"："Starts playback exactly like "Play/Stop", but stopping playback (or recording) sets the editing cursor, or the left edge of the selection region, to the stop point so that playback can be resumed from there." | 已確認 |
| 同上 | "Pause P"："Temporarily pauses playing or recording without losing your place." | 已確認 |
| [Audacity：Playback][aud-playback] Stop and Set Cursor | "There is no button for this, but a shortcut X is provided." | 已確認 |
| [Ableton：快捷鍵][ableton-keys] 42.20 Transport | 表列 "Play from Start Marker/Stop"：Space；"Continue Play from Stop Point"：Shift+Space；"Move Insert Marker to Beginning"：Home | 已確認 |
| 同上，Arrangement View 的表 | 表列 "Move Insert Marker to Playhead Position"：Ctrl+Shift+Space（Win）、Cmd+Shift+Space（Mac） | 已確認 |
| [Ableton：Arrangement View][ableton-arr] | "To return the insert marker to the starting play position, you can double-click the Stop button or press the Home key (Win) or Function + left arrow key (Mac)." | 已確認 |
| [Transcribe! FAQ][ts-faq] 第 11 題 | "If you want to continue playback from the paused point instead, then you need to un-pause. You can do this with the comma or semicolon keys (see Help - Application or File menu - Keyboard Shortcuts), or the pause button in the lower toolbar." | 已確認 |
| 同上 | "If you want the spacebar to resume paused playback instead of starting again from the current point then you could use Keyboard Shortcuts on the File menu to have the spacebar trigger the command "PlayResume"." | 已確認 |
| 同上，第 14 題 | "One particular shortcut that is relevant here is 'E' which sets the current point to the currently playing or paused point." | 已確認 |
| 同上，第 14 題 | "Another option that you might try is Preferences - Playback - "Paused playback point follows selection" (first appeared in Transcribe! 9.0)." | 已確認（設定存在；做什麼要看程式內的 Help，沒讀到） |
| [DaVinci Resolve 20 手冊][resolve] 第 731 頁 | "When using the JKL keys to navigate the Viewer in this mode, “K” will pause the playhead in place, while the space bar (stop) will go to last position." | 已確認 |
| 同上，第 727 頁 | "Play Again: Press Option-L to immediately restart playback from where the playhead began without stopping; for instances where you quickly want to replay the beginning of what you’re listening to." | 已確認 |
| [Logic：Use transport key commands][logic-keys] | "Most of these transport key commands have no default assignment, and need to be assigned manually." | 已確認 |
| 同上 | "Stop or Play from Last Position: Stops playback at the current playhead position, or starts playback from the last playhead position, depending on the play or stop status when the command is used." | 已確認 |
| 同上 | "Go to Last Locate Position: Moves the playhead to the last position reached with a positioning command, or direct positioning of the playhead using the mouse or ruler."；"Stop and Go to Last Locate Position: As above, but stops playback." | 已確認 |
| 同上 | "Play or Stop and Go to Last Locate Position: Starts playback at the current playhead position, or stops playback and moves the playhead to its last position, depending on the play or stop status when the command is used." | 已確認 |
| 同上 | "Stop and Go to Left Locator: Stops playback, and moves the playhead to the left locator position."；"Stop and Go to Beginning: Stops playback and moves the playhead to the project start position." | 已確認 |
| 同上 | "Note: You can assign this command directly to the Stop button, by Control-clicking the Stop button and choosing the setting in the shortcut menu." | 已確認 |
| [Logic：Use transport shortcut menus][logic-menus] | Stop 按鈕的選單項目："Stop: Stops project playback."；"Stop and Go to Left Locator: Stops playback. The playhead moves to the left locator position."；"Stop and Go to Last Locate Position: Stops playback. The playhead moves to the last locate position." | 已確認 |
| [Logic：Control playback][logic-transport] | "Pause button: Pauses playback or recording, until you click either the Pause or Play button." | 已確認 |
| [Cubase：Transport 類快捷鍵][cubase-keys] | 表列 Start：Enter；Stop：Num 0；Start/Stop：Space | 已確認（經摘要工具） |
| [Pro Tools Reference Guide][pt] Using Separate Play and Stop Keys | "When enabled, the Use Separate Play and Stop Keys option lets you start playback with the Enter key and stop playback with the 0 key on the numeric keypad." | 已確認。這是把播放和停止分成兩個鍵，不是兩種停止 |
| [Amazing Slow Downer iOS 手冊][asd-ios] | "At the bottom of the screen you'll find the regular Play/Stop and Rewind buttons as well as a Cue slider." | 已確認 |

補充：

- Transcribe! 第 11 題最後一句："Current versions of Transcribe! (from 9.20 onwards) have the <enter> key programmed by default to do this."。前一句同時講到 "PlayResume" 和 "PlaySpacebar"，"do this" 指哪一個看不出來。Enter 鍵在 9.20 以後有預設功能是已確認；是哪個功能，**部分確認**。
- Logic 的 "last locate position" 是「上一次用定位指令或用滑鼠、尺直接放播放頭的位置」，手冊沒有說它等於「這次播放開始的位置」。推論：使用者點了尺再播放時兩者相同。**部分確認**。

## 常見做法歸納

只歸納上面已確認或部分確認的列。這裡還是事實，不是建議。

### 停止後播放頭的位置（問題 2、3）

| 做法 | 產品 | 另一種行為怎麼做 |
|---|---|---|
| A. 預設回到開始位置（或下次從原起點播），另給「從這裡繼續」的鍵 | REAPER、Audacity、Transcribe!、Ableton | REAPER：Pause（Enter）、可指定的 action。Audacity：X、P。Transcribe!：逗號、分號、PlayResume、E。Ableton：Shift+Space |
| B. 一個開關切換兩種行為，Space 只有一個意思 | Cubase（"Return to Start Position on Stop"）、Pro Tools（"Timeline Insertion/Play Start Marker Follows Playback"）、DaVinci Resolve（"Stop and Go to Last Position"） | 切開關。Pro Tools 的開關有快捷鍵 Control+N／Start+N。Resolve 開了之後 K 是留在原地 |
| C. 停止留在原地，回去是第二下或另外的指令 | Logic Pro（部分確認） | Stop 第二下；"Stop and Go to Last Locate Position" 等 key commands；可把其中一種指定給 Stop 按鈕 |
| D. 手冊沒寫 | Final Cut Pro、VLC、Amazing Slow Downer | — |

A 組四個產品都是音訊或練習工具，而且都有一個和播放頭分開的「起點記號」：REAPER 的 edit cursor、Audacity 的 editing cursor、Transcribe! 的 current point（紅色三角形）、Ableton 的 insert marker。播放從這個記號開始，已確認。停止不會移動它：REAPER、Audacity 有原文；Transcribe!、Ableton 是從「再按一次 Space 還是從記號開始」推得，**部分確認**。

A 組裡，「繼續」的做法又分兩種：

- **暫停鍵**（不動起點記號，只是從停下的地方接著播）：REAPER Pause、Audacity Pause、Transcribe! un-pause、Ableton Shift+Space。
- **把起點記號搬到停下的地方**：REAPER "Transport: Play/stop (move edit cursor to stop)"、Audacity "Play/Stop and Set Cursor"、Transcribe! 的 E 鍵、Ableton "Move Insert Marker to Playhead Position"。

### 循環範圍（問題 1）

| 做法 | 產品 |
|---|---|
| 時間尺上拖出一段，和選取分開 | Ableton（loop brace）、Logic（cycle area）、Cubase（locators）、Audacity（looping region）、REAPER（可設定是否和 time selection 連動） |
| 範圍就是目前的選取 | Pro Tools、Transcribe!、Final Cut Pro；REAPER 連動時 |
| I、O 鍵設 In、Out 點 | Final Cut Pro、DaVinci Resolve |
| 播放中點按鈕標起點、終點 | Transcribe!（"A-B Loop" 按兩下）、Amazing Slow Downer（兩個 "Set" 按鈕）、VLC for Android（SET START POINT、SET END POINT） |
| 一個指令把選取變成循環範圍 | Ableton（Ctrl+L／Cmd+L）、Logic（Command-U）、Cubase（P；Alt/Opt-P 會同時開始播）、Audacity（Shift+L）、REAPER（Ctrl 加雙擊 item） |
| 用數字微調 | Ableton（Loop Start、Loop Length 欄位）、Logic（LCD 的 locator 欄位）、Amazing Slow Downer（按住 "Set" 進 "Trim Loops"） |
| 整段平移、加倍、減半 | Ableton（方向鍵平移、Ctrl／Cmd 加上下鍵加倍減半）、Logic（"Move Locators Forward by Cycle Length"）、Amazing Slow Downer（箭頭、"1/2"、"x2"） |
| 存多段範圍再叫回來 | Transcribe!（stored loops）、Amazing Slow Downer（"Manage Loops"） |

開關：

- 循環開關和範圍分開，有自己的按鈕或快捷鍵：Ableton、Cubase、Logic、Pro Tools、REAPER、Audacity、DaVinci Resolve、Final Cut Pro、Transcribe!、Amazing Slow Downer。已確認（Cubase 經摘要工具）。
- 拖出範圍就自動打開循環：Logic、Audacity。已確認。
- 循環預設開著：Transcribe!。已確認。
- 沒有另外的開關，設完終點就開始循環，關掉是另一個按鈕：VLC for Android。已確認。

播放頭在範圍外時按播放：

- **跳到範圍起點開始**：Logic（Cycle 開著時）。Cubase 選 "Start from Cycle Start" 時。Ableton 勾了 "Set Song Start Time Here" 時。
- **從另外指定的位置開始，播進範圍後才循環**：Transcribe!（Control 點波形），已確認。Pro Tools 的 Dynamic Transport 起點是 Play Start Marker，已確認；播進範圍後循環、在範圍後面不會跳回去，手冊只在「播放中改選取」的情境寫到，套到這裡是推論，**部分確認**。
- **從游標或起點記號開始，之後會不會進入循環沒有資料**：Ableton 預設，**未確認（沒寫）**；Cubase 選 "Start from Project Cursor Position" 時，**經摘要工具查無**。
- 其他產品查無。

## 來源

廠商手冊與官方說明頁：

- Ableton Live 12 手冊：[Arrangement View][ableton-arr]、[Live Keyboard Shortcuts][ableton-keys]。頁面標 Version 12。下載原頁讀文字。原頁的快捷鍵是分開的按鍵圖示，本文寫成 Ctrl+L 這種形式。
- Cubase Pro 15.0 線上說明：[Transport Menu][cubase-tm]、[Left and Right Locators][cubase-loc]、[Setting up Locator Ranges][cubase-range]、[Transport Category][cubase-keys]。版本取自網址路徑。經摘要工具。
- Logic Pro User Guide for Mac：[Control playback with the transport buttons][logic-transport]、[Use transport shortcut menus][logic-menus]、[Use transport key commands][logic-keys]、[Use the cycle area][logic-cycle]。網址路徑標 13.0／mac／27。下載原頁讀文字。
- [Pro Tools Reference Guide][pt]：Version 2024.10，"Created 11/6/2024 • REV A"。下載 PDF 讀文字。
- [REAPER User Guide][reaper]："Up and Running: A REAPER User Guide v 7.86"，November 2026，Geoffrey Francis 著，放在 reaper.fm 的[使用手冊頁][reaper-page]。下載 PDF 讀文字。
- Audacity 3.7 Reference Manual：[Transport Menu: Playing][aud-playing]、[Transport Menu: Looping][aud-looping]、[Timeline][aud-timeline]、[Playback][aud-playback]、[Transport Toolbar][aud-toolbar]、[Keyboard Shortcut Reference][aud-keys]。頁尾標 "This version created on 2026-09-02"。下載原頁讀文字。
- [DaVinci Resolve 20 Reference Manual][resolve]：July 2025。下載 PDF 讀文字。手冊只寫 Mac 的快捷鍵。
- Final Cut Pro User Guide for Mac：[Play media][fcp-play]、[Keyboard shortcuts][fcp-keys]、[Select ranges][fcp-ranges]。網址路徑標 12.4／mac／26.6。下載原頁讀文字。
- [Transcribe! FAQ][ts-faq]：Seventh String 官網。頁面沒標日期，內文提到 9.0、9.20、9.42 版。下載原頁讀文字。
- Amazing Slow Downer：[iOS 播放器手冊][asd-ios]、[Android 手冊][asd-android]。Roni Music 官網，頁面沒標版本。下載原頁讀文字。
- VLC：[VLC for Android 3.X Video Player][vlc-android-video]、[Audio Player][vlc-android-audio]、[VLC Desktop 3.0 Hotkeys][vlc-hotkeys]。docs.videolan.me。下載原頁讀文字。

沒讀到的官方頁（網址來自搜尋結果，內容沒有查核）：

- Premiere Pro：[Loop playback in Premiere][premiere-loop]、[Premiere keyboard shortcuts][premiere-keys]。
- Anytune：[Looping][anytune]。

查核限制：

- **Premiere Pro**：helpx.adobe.com 對下載和摘要工具都回傳 HTTP 403，連 PDF 手冊也是。搜尋結果的摘要提到「設 In、Out 點後按 monitor 按鈕列的 Loop 圖示，圖示不在時從 Button Editor 拖出來」，但沒開到原頁，不能當作已確認。
- **Anytune**：說明中心在 anytune.zendesk.com，回傳 HTTP 403。官網首頁只有宣傳文字。
- **Cubase**：www.steinberg.help 的頁面由 JavaScript 產生，直接下載只有空殼。只能用摘要工具讀，工具回傳的引文每句不超過約 125 字元。同一頁問了兩次，回傳的句子一致。舊版（archive.steinberg.help）回傳 403；搜尋結果說第 13 版以前這個選項在 Preferences > Transport，**未確認（打不開）**。
- **Pro Tools**：www.avid.com 的線上 user guide 回傳 403，改讀 2024.10 的 PDF。有沒有更新的版本沒有查。
- **Transcribe!**：完整說明在程式內的 Help 選單（FAQ 第 2 題："Full documentation is in the Help that comes with Transcribe! itself"），網路上沒有，只讀了 FAQ。
- **VLC 桌面版**：官方文件讀了 Hotkeys、Playback 兩頁，都沒提 A-B loop。Hotkeys 頁的完整熱鍵表是圖片，沒讀到。
- **Audacity**：手冊的 Looping 教學頁寫已搬到 support.audacityteam.org，那個網址回傳 404。
- 所有結論都只根據手冊文字，沒有實際操作軟體。查不到的預設值（Cubase、Pro Tools、Resolve 的開關預設）沒有憑記憶補。
- 引文查核：除了 Cubase 和 VLC for Android 帶圖示的句子，其餘英文引文都用程式比對過下載的原頁或 PDF 文字，逐字相符（只忽略空白和彎引號的差別）。
- Logic、Final Cut Pro 的版本號取自網址路徑，頁面內文沒有另外寫版本。

[ableton-arr]: https://www.ableton.com/en/live-manual/12/arrangement-view/
[ableton-keys]: https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
[cubase-tm]: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/playback/playback_transport_menu_functions_r.html
[cubase-loc]: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/playback/playback_left_and_right_locator_c.html
[cubase-range]: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/playback/playback_setting_up_locator_ranges_t.html
[cubase-keys]: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/key_commands/key_commands_transport_category_c.html
[logic-transport]: https://support.apple.com/guide/logicpro/control-playback-with-the-transport-buttons-lgcp0b07c0c9/mac
[logic-menus]: https://support.apple.com/guide/logicpro/use-transport-shortcut-menus-lgcpc2e497bd/13.0/mac/27
[logic-keys]: https://support.apple.com/guide/logicpro/use-transport-key-commands-lgcp2814a670/13.0/mac/27
[logic-cycle]: https://support.apple.com/guide/logicpro/use-the-cycle-area-lgcp59e41e86/13.0/mac/27
[pt]: https://resources.avid.com/SupportFiles/PT/Pro_Tools_Reference_Guide_2024.10.pdf
[reaper]: https://www.reaper.fm/userguide/ReaperUserGuide786c.pdf
[reaper-page]: https://www.reaper.fm/userguide.php
[aud-playing]: https://manual.audacityteam.org/man/transport_menu_playing.html
[aud-looping]: https://manual.audacityteam.org/man/transport_menu_looping.html
[aud-timeline]: https://manual.audacityteam.org/man/timeline.html
[aud-playback]: https://manual.audacityteam.org/man/playback.html
[aud-toolbar]: https://manual.audacityteam.org/man/transport_toolbar.html
[aud-keys]: https://manual.audacityteam.org/man/keyboard_shortcut_reference.html
[resolve]: https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_20_Reference_Manual.pdf
[fcp-play]: https://support.apple.com/guide/final-cut-pro/play-media-ver90ba4ef0/12.4/mac/26.6
[fcp-keys]: https://support.apple.com/guide/final-cut-pro/keyboard-shortcuts-ver90ba5929/12.4/mac/26.6
[fcp-ranges]: https://support.apple.com/guide/final-cut-pro/select-ranges-ver28cca92/12.4/mac/26.6
[ts-faq]: https://www.seventhstring.com/xscribe/faq3.html
[asd-ios]: https://www.ronimusic.com/manuals/AudioPlayerHelp.htm
[asd-android]: https://www.ronimusic.com/manuals/ASD_Android_Manual.htm
[vlc-android-video]: https://docs.videolan.me/vlc-user/android/3.X/en/video/video_player.html
[vlc-android-audio]: https://docs.videolan.me/vlc-user/android/3.X/en/audio/audio_player.html
[vlc-hotkeys]: https://docs.videolan.me/vlc-user/desktop/3.0/en/basic/hotkeys.html
[premiere-loop]: https://helpx.adobe.com/premiere/desktop/render-and-export/render-sequences-for-playback/play-back-in-a-continuous-loop.html
[premiere-keys]: https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html
[anytune]: https://anytune.zendesk.com/hc/articles/360025901972-Looping
