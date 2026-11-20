// 給教練看的原因的代號（ADR 0017「伺服器不翻譯」）：代號＋要放進句子的東西，畫面照使用者的語言寫成句子。
// 流程核心也照樣寫一份中文（message），給還不認得代號的分頁看；中文寫在這裡的 ZH，
// 要跟 messages/zh-TW.json 同名的句子一字不差（有測試），畫面用的就是那邊的句子。

/** 要放進句子的東西：資料本身（數字、教練取的名字），或另一個原因（一層包一層）。 */
export type WhyParam = string | number | Why;

/** 原因：代號是 messages/*.json 裡句子的名字，其他欄位照句子裡的 {名字} 放。 */
export type Why = { code: WhyCode; [param: string]: WhyParam };

/** 給教練看的原因：中文一份（message），有代號就帶 why。 */
export interface Said {
	message: string;
	why?: Why;
}

/** 原因寫成中文：ZH 的句子把 {名字} 換成 why 裡的東西，包著的原因也寫成中文。text：句子（測試換一份看換字的規則）。 */
export function zh(why: Why, text: Readonly<Record<string, string>> = ZH): string {
	return text[why.code].replace(/\{(\w+)\}/g, (_, name: string) => {
		const v = why[name];
		return typeof v === 'object' ? zh(v, text) : String(v);
	});
}

/** 原因：沒代號（還沒改的）只有中文，有代號就多帶 why。 */
export const said = (reason: string | Why): Said =>
	typeof reason === 'string' ? { message: reason } : { message: zh(reason), why: reason };

/**
 * 每個代號的中文：跟 messages/zh-TW.json 同名的句子一字不差（why.test.ts）。
 * 照流程核心的檔分段，名字用檔名開頭（例：commands_）。
 */
const ZH = {
	// commands.ts
	commands_no_flow: '沒有開著的流程',
	commands_none: '沒有指令',
	// cues.ts
	cues_chant: '口號段不數拍，不能放拍點',
	cues_no_kind: '沒有這種拍點',
	cues_motion_one_beat: '手位只佔一拍',
	cues_count_word: '拍子只能是 down 或 up',
	cues_no_word: '請寫拍點的字',
	cues_no_role: '動作裡沒有人是「{role}」',
	cues_member_not_in_action: '這個隊員不在動作裡',
	cues_no_action: '找不到這個動作',
	cues_nothing_copied: '沒有複製的拍點',
	cues_paste_blocked: '貼不下：{reason}',
	// roles.ts
	roles_no_name: '請填任務角色名稱',
	roles_name_taken: '已經有「{name}」這個任務角色了',
	roles_member_name_taken: '已經有叫「{name}」的隊員了，任務角色取別的名稱，拍點的「給誰」才分得出是角色還是人',
	roles_not_found: '找不到這個任務角色',
	roles_delete_used_one: '「{name}」用在 {count} 個動作裡：刪掉後那些人變成沒有任務，給「{name}」的拍點也會刪掉',
	roles_delete_used: '「{name}」用在 {count} 個動作裡：刪掉後那些人變成沒有任務，給「{name}」的拍點也會刪掉'
} satisfies Record<string, string>;

export type WhyCode = keyof typeof ZH;

/** 有代號的句子（測試用：每一句都要跟 zh-TW.json 一樣）。 */
export const ZH_TEXT: Readonly<Record<WhyCode, string>> = ZH;
