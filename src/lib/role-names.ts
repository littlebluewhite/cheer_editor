// 權限的名字（#250）：分享對話框、首頁「分享給我的」、被改權限的提示都用這幾個字。
import type { Role } from '#lib/server-api.js';

export const ROLE_NAMES: Record<Role, string> = {
	owner: '擁有者',
	editor: '編輯者',
	recorder: '記錄者',
	viewer: '檢視者'
};

/** 能改流程（擁有者、編輯者）；記錄者、檢視者打開一律是檢視模式。 */
export const canEdit = (role: Role) => role === 'owner' || role === 'editor';
