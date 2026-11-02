/// <reference types="@unplugin-pwa/core/vanillajs" />
import { registerSW } from 'virtual:pwa-register';

// 可離線：註冊 service worker。部署新版後，使用者重新整理時新的 service worker 會裝好並接手，
// 接手後頁面自動再載入一次，就是新版（vite.config.ts 的 registerType: 'autoUpdate'）。
registerSW({ immediate: true });
