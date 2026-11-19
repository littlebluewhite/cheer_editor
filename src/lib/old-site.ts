// 舊網址版（GitHub Pages 上的那份，#267、ADR 0012）：建置時設 OLD_SITE=1 才是（vite.config.ts）。
// 不能登入、不碰伺服器；首頁最上面一條黃的搬家提示。

/** 這次建的是舊網址版。 */
export const OLD_SITE: boolean = __OLD_SITE__;

/** 新網址（首頁黃條的「到新網址」）。 */
export const NEW_SITE_URL = 'https://littlebluewhite.com/';
