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
	// flow.ts
	flow_no_name: '請幫流程取名字',
	flow_strips: '條數要是 {min}–{max} 的整數',
	flow_stacked: '這樣調整，這些人會疊在同一點（之後可以再拖開）：',
	// time-rules.ts
	time_rules_positive: '秒數要大於 0',
	time_rules_chant: '「口號段加起來最少」要比「整支流程最多」少',
	time_rules_music: '「音樂段加起來最多」不能超過「整支流程最多」',
	// flow-check.ts
	flow_check_max_members: '一支流程最多 {max} 人',
	flow_check_in_action: '動作「{action}」：{reason}',
	flow_check_in_formation: '站位 {n}：{reason}',
	flow_check_in_segment: '{segment}：{reason}',
	flow_check_off_field: '{member} {reason}',
	flow_check_formation_order: '站位 {n} 要在站位 {before} 之後、段的時間裡',
	flow_check_twice: '同一個人只能放一次',
	flow_check_no_role: '沒有「{role}」這個任務角色',
	flow_check_clash: '{member} 同一時間在「{first}」和「{second}」裡',

	// time.ts
	time_start_unreadable_music: '開始看不懂，例：3-5&',
	time_start_unreadable_chant: '開始看不懂，請打秒數',
	time_length_unreadable: '長度看不懂',
	time_unreadable: '{field}看不懂，例：{example}',
	time_unreadable_other: '{field}看不懂，例：{example}（別的段前面加段名，例：{other}）',
	time_field_depart: '出發',
	time_field_arrive: '到達',
	time_field_formation: '站位時間',
	time_field_time: '時間',
	time_no_segments: '還沒有段',
	time_jump_chant: '{segment} 是口號段，要打秒數；八拍寫法前面加段名，例：{example}',
	time_negative: '時間不能是負的',
	time_segment_only: '{segment} 只有 {size}',
	// 別的原因包進去的時間字
	time_segment_music: '音樂 {n}',
	time_segment_chant: '口號 {n}',
	time_in_segment: '{segment} {at}',
	time_seconds: '{n} 秒',
	time_length_beat_one: '{n} 拍',
	time_length_beats: '{n} 拍',
	time_eights_one: '{n} 個八拍',
	time_eights: '{n} 個八拍',

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
	cues_paste_over_end: '拍點會超出動作的結尾 {length}',
	// beat-range.ts
	beat_range_cue_half_beat: '拍點要落在半拍上',
	beat_range_cue_whole_beats: '拍點要佔整數拍，至少 1 拍',
	beat_range_cue_inside: '拍點要在動作裡面',
	beat_range_phase_half_beat: '環節要落在半拍上',
	beat_range_phase_on_beat: '環節要標在整拍上',
	beat_range_phase_whole_beats: '環節要佔整數拍，至少 1 拍',
	beat_range_phase_inside: '環節要在動作裡面',
	// text-length.ts（field 是下面的欄位名）
	text_length_too_long: '{field}最多 {max} 個字',
	text_length_too_long_kept: '{field}最多 {max} 個字（原本就有 {count} 個字，不能再變長）',
	text_length_flow_name: '流程名字',
	text_length_member_name: '隊員名字',
	text_length_action_name: '動作名稱',
	text_length_formation_name: '站位名稱',
	text_length_role_name: '任務角色名稱',
	text_length_note: '備註',
	// roles.ts
	roles_no_name: '請填任務角色名稱',
	roles_name_taken: '已經有「{name}」這個任務角色了',
	roles_member_name_taken: '已經有叫「{name}」的隊員了，任務角色取別的名稱，拍點的「給誰」才分得出是角色還是人',
	roles_not_found: '找不到這個任務角色',
	roles_delete_used_one: '「{name}」用在 {count} 個動作裡：刪掉後那些人變成沒有任務，給「{name}」的拍點也會刪掉',
	roles_delete_used: '「{name}」用在 {count} 個動作裡：刪掉後那些人變成沒有任務，給「{name}」的拍點也會刪掉',
	// phases.ts
	phases_no_action: '找不到這個動作',
	phases_no_segment: '找不到這一段',
	phases_not_found: '找不到這個環節',
	phases_music_needs_beats: '音樂段的環節要選拍標',
	phases_delete_one: '會刪掉 {count} 個環節，{lost}（清掉的紀錄按「復原」會回來），確定就刪掉',
	phases_delete: '會刪掉 {count} 個環節，{lost}（清掉的紀錄按「復原」會回來），確定就刪掉',
	phases_delete_none_left_one: '會刪掉 {count} 個環節，{lost}（清掉的紀錄按「復原」會回來）；動作沒有環節了，不再記成功率，確定就刪掉',
	phases_delete_none_left: '會刪掉 {count} 個環節，{lost}（清掉的紀錄按「復原」會回來）；動作沒有環節了，不再記成功率，確定就刪掉',

	// insert-beats.ts
	insert_beats_no_segment: '找不到這一段',
	insert_beats_length: '插入的長度要大於 0',
	insert_beats_outside: '插入的地方不在這一段裡',
	insert_beats_overflow_formation: '站位 {n} 會超過這段的結尾，{room}',
	insert_beats_overflow_action: '「{action}」會超過這段的結尾，{room}',
	insert_beats_room: '最多插 {length}',
	insert_beats_room_eights_rest: '最多插 {eights}又 {rest}',
	insert_beats_room_under_eight: '最多插 {length}（不到 1 個八拍，單位改成拍）',
	insert_beats_room_none: '這段後面已經沒有空了',

	// members.ts（first、rest：一串原因一個接一個；more：後面接著的那句，沒有是空的）
	members_no_name: '請填隊員名字',
	members_pick_gender: '請選性別',
	members_pick_global_role: '請選全局角色',
	members_line_columns: '一行寫一個名字，或「名字、性別、全局角色」三欄（用 Tab、空白或逗號隔開）',
	members_line_gender: '性別要寫「男」或「女」',
	members_line_global_role: '全局角色要寫「底層」或「上層」',
	members_line_task_role: '「{role}」是任務角色（每個動作各自設），全局角色要寫「底層」或「上層」',
	members_problems: '{first}；{rest}',
	members_lines: '{first}\n{rest}',
	members_list: '{first}、{rest}',
	members_quoted: '「{name}」',
	members_named: '{names}：{problem}',
	members_too_many: '一支流程最多 {max} 人，這次加 {count} 人，只能再加 {left} 人',
	members_full: '一支流程最多 {max} 人，已經滿了',
	members_not_found: '找不到這個隊員',
	members_first: '已經是第一個了',
	members_last: '已經是最後一個了',
	members_rename_records_one: '{name} 改名成「{newName}」，他在的組和他自己有 {count} 次紀錄：只是改錯字就保留舊紀錄，換了人就清掉重算{undoable}',
	members_rename_records: '{name} 改名成「{newName}」，他在的組和他自己有 {count} 次紀錄：只是改錯字就保留舊紀錄，換了人就清掉重算{undoable}',
	members_delete: '刪掉隊員「{name}」（標記 {marker}、{role}）：{where}{more}',
	members_delete_in_none: '他不在任何動作裡',
	members_delete_in_one: '他在 {count} 個動作裡',
	members_delete_in: '他在 {count} 個動作裡',
	members_delete_in_one_emptied: '他在 {count} 個動作裡，其中 {emptied} 個會被整個刪掉',
	members_delete_in_emptied: '他在 {count} 個動作裡，其中 {emptied} 個會被整個刪掉',
	members_delete_cues_one: '，會一起拿掉 {count} 個拍點{more}',
	members_delete_cues: '，會一起拿掉 {count} 個拍點{more}',
	members_delete_records_one: '，會清掉 {count} 次紀錄{undoable}{more}',
	members_delete_records: '，會清掉 {count} 次紀錄{undoable}{more}',
	members_delete_lost: '，{list}{more}',
	members_lost_role: '「{action}」會沒有{role}',
	members_lost_role_squad: '「{action}」第 {squad} 組會沒有{role}',
	members_delete_renumber_one: '；後面 {count} 個人的號碼會往前遞補{more}',
	members_delete_renumber: '；後面 {count} 個人的號碼會往前遞補{more}',
	members_delete_changed: '；{question}{undoable}{more}',

	// segment-order.ts
	segment_order_no_segment: '找不到這一段',
	segment_order_first: '已經是第一段了',
	segment_order_last: '已經是最後一段了',
	segment_order_chant: '口號段不能切',
	segment_order_playhead_outside: '播放頭不在這一段',
	segment_order_first_eight: '播放頭在第一個八拍，切不開：先把播放頭移到要切開的那個八拍',
	segment_order_across: '動作「{action}」（{start} 起）跨過 {cut}，切不開',
	segment_order_delete: '刪掉{segment}，下面這些也會一起刪掉',
	segment_order_delete_records_one: '刪掉{segment}，下面這些也會一起刪掉，會一起清掉 {count} 次紀錄{undoable}',
	segment_order_delete_records: '刪掉{segment}，下面這些也會一起刪掉，會一起清掉 {count} 次紀錄{undoable}',

	// records.ts
	records_no_action: '找不到這個動作',
	records_not_recorded: '這個動作沒有記成功率',
	records_run_through_empty: '每個動作都沒做，沒有要存的',
	records_in_action: '{action}：{reason}',
	records_none_that_day: '這一天還沒有紀錄',
	records_attempt_not_found: '找不到這一次',
	records_run_through_marks: '全上的一次每個環節都要有記號（✗ 做完之後才開始的、跟 ✗ 佔同樣拍的不用）',
	records_attempt_exists: '這一次已經在了',
	records_no_run_through_that_day: '這一天還沒有全上',
	records_attempts_not_found: '找不到這幾次',
	records_run_through_exists: '這次全上已經在了',
	// 別的原因包進去的：會清掉的紀錄（確認框）、按復原會回來
	records_loss_both: '一起清掉 {reps}和 {marks}',
	records_loss_reps: '一起清掉 {reps}',
	records_loss_marks: '清掉 {marks}',
	records_reps_one: '{n} 次紀錄',
	records_reps: '{n} 次紀錄',
	records_marks_one: '{n} 次的記號',
	records_marks: '{n} 次的記號',
	records_undoable: '（清掉的紀錄按「復原」會回來）',

	// segment.ts
	segment_no_segment: '找不到這一段',
	segment_chant_no_audio: '口號段沒有音樂',
	segment_audio_broken: '音樂檔壞了，請重新選檔',
	segment_load_audio_first: '先載入音樂檔',
	segment_under_one_beat: '第一拍之後剩下不到一拍',
	segment_first_beat_past_end: '第一拍要在音樂結束（{end}）之前',
	segment_no_audio: '找不到這個音樂檔',
	segment_audio_types: '只能載入 mp3、m4a、wav',
	segment_bpm_range: 'BPM 要在 {min} 到 {max} 之間',
	segment_first_beat_range: '第一拍要是 0 秒以上',
	segment_eights_range: '八拍數要在 1 到 {max} 之間',
	segment_eights_integer: '八拍數要是整數',
	segment_last_beats_range: '最後一個八拍的拍數要在 1 到 8 之間',
	segment_last_beats_integer: '最後一個八拍的拍數要是整數',
	segment_seconds_range: '口號段長度要在 0.1 到 {max} 秒之間',
	segment_file_music_range: '音樂段要在 1 到 {max} 個八拍之間',
	segment_trim_blocked: '動作「{action}」裁短後：{reason}',
	segment_shrink: '{segment} 縮短後，{what}',
	segment_shrink_records: '{segment} 縮短後，{what}，會{lost}{undoable}',
	segment_shrink_trim: '超出段尾的動作裁短到段尾',
	segment_shrink_drop: '放不進段裡的刪掉',
	segment_shrink_both: '超出段尾的動作裁短到段尾，放不進段裡的刪掉'
} satisfies Record<string, string>;

export type WhyCode = keyof typeof ZH;

/** 有代號的句子（測試用：每一句都要跟 zh-TW.json 一樣）。 */
export const ZH_TEXT: Readonly<Record<WhyCode, string>> = ZH;
