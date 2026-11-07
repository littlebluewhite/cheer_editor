// 流程核心那包的指紋：建置時算好（vite.config.ts），伺服器帶的是同一個；連上時比對（ADR 0010）。

/** 流程核心那包的指紋（SHA-256）。 */
export const CORE_FINGERPRINT: string = __CORE_FINGERPRINT__;
