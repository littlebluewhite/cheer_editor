// 畫面元件共用的小工具：讀數字欄位。

/** 數字欄位 onchange 時的值（空白或看不懂是 NaN，交給流程核心擋）。 */
export const numberValue = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber;
