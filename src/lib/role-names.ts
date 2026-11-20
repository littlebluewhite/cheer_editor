// 權限的名字（#250）：分享對話框、首頁「分享給我的」、被改權限的提示都用這幾個字。
import type { Role } from '#lib/server-api.js';
import { m } from '#lib/paraglide/messages.js';

/** 每次讀都照畫面的語言寫。 */
export const ROLE_NAMES: Record<Role, string> = {
	get owner() {
		return m.share_role_owner();
	},
	get editor() {
		return m.share_role_editor();
	},
	get recorder() {
		return m.share_role_recorder();
	},
	get viewer() {
		return m.share_role_viewer();
	}
};

/** 能改流程（擁有者、編輯者）；記錄者、檢視者打開一律是檢視模式。 */
export const canEdit = (role: Role) => role === 'owner' || role === 'editor';
