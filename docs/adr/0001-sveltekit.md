# 第一版用 SvelteKit，不只用 Svelte + Vite

第一版只有一個頁面，沒有伺服器，也沒有登入，放在 GitHub Pages 當靜態網站。只用 Svelte + Vite 就夠了。但我們還是選了 SvelteKit（用 adapter-static 輸出），因為以後很可能會加登入、雲端這類要伺服器的功能。到時候只要換部署用的 adapter，不用整個重搭。代價是第一版要多學、多設定一些東西。

見「第一版用什麼技術做」（littlebluewhite/cheer_editor#11）。
