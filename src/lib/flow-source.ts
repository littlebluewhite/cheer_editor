// 流程來源（#322）：開著的這支流程從哪來，和從它算出的「能做什麼」（每一項附原因）。
// 流程檔 module 握著一個來源值（editor.file.source）；窄、寬兩個選單、上方列的按鈕都照 whatCanDo 的答案畫，不自己拼旗標。
// 練習畫面、全上能不能記直接讀練習的權限（session.practice.cannotRecord：「記」被擋時要說的那句也在那）；
// 離線副本那一條灰的直接讀來源（要 savedAt；存檔狀態的 offline_copy 還要看斷線了沒，不一樣）。
// 管：四種來源長什麼樣子（本機流程、雲端流程、分享連結、離線副本），和每種來源 × 權限 × 連線狀態 → 能做什麼、原因。
// 不管：來源什麼時候換（流程檔 module 開檔、打開雲端流程、回首頁時換）、權限和連線怎麼變（CloudSteps）、
// 能不能記（練習的權限，practice-rights.ts；這裡只照它的 cannotRecord 回答）、畫面上寫什麼字（頁面照原因、狀態挑 m.xxx()），
// 也不管窄螢幕不能編這種版面的事（頁面自己決定窄螢幕放哪幾項）。

import type { CloudSteps } from '#lib/cloud-steps.svelte.js';
import type { PracticeRights } from '#lib/practice-rights.js';
import { canEdit } from '#lib/role-names.js';

/** 開著的流程從哪來。在首頁（沒開流程）也是本機。 */
export type FlowSource =
	/** 本機流程：草稿、流程檔，存檔、草稿留著。 */
	| { readonly kind: 'local' }
	/** 雲端流程：每一步送伺服器存；權限、連線、有新版看 steps（開著時會變）。 */
	| { readonly kind: 'cloud'; readonly id: string; readonly steps: CloudSteps }
	/** 斷網時從這台的離線副本打開的雲端流程（#261）：savedAt 是那份是什麼時候的樣子（毫秒）；連上了就換成雲端流程。 */
	| { readonly kind: 'offline'; readonly id: string; readonly steps: CloudSteps; readonly savedAt: number }
	/** 用分享連結看的（沒有權限，#251）：只拿到編排，檢視模式，不連房間。 */
	| { readonly kind: 'link'; readonly id: string };

/** 本機流程（也是在首頁時）的來源。 */
export const LOCAL: FlowSource = Object.freeze({ kind: 'local' });

/**
 * 能、不能的原因：
 * local 本機流程；cloud 雲端流程（每一步都存了：沒有開檔、新建、存檔，不寫「這台」）；offline_copy 離線副本（同雲端流程）；
 * link_only 用分享連結看的（沒有權限）；owner_or_editor、recorder_or_viewer 雲端流程的權限；signed_out 沒登入；
 * disconnected 斷線了；new_version 有新版（要重新整理）；practice_rights 練習的權限說不能記（原因在 session.practice.cannotRecord）。
 */
export type CanWhy =
	| 'local'
	| 'cloud'
	| 'offline_copy'
	| 'link_only'
	| 'owner_or_editor'
	| 'recorder_or_viewer'
	| 'signed_out'
	| 'disconnected'
	| 'new_version'
	| 'practice_rights';

/** 一項能不能做，和為什麼。 */
export interface Can {
	readonly ok: boolean;
	readonly why: CanWhy;
}

/**
 * 名字旁存檔狀態的字：unsaved 未存；saving 存中…；saved ✓ 已存；disconnected ⚠ 斷線；offline_copy ⚠ 離線（離線副本還沒連上）；
 * null 不寫（本機流程沒改過、雲端流程有新版）。
 */
export type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'disconnected' | 'offline_copy' | null;

/** 這支流程能做什麼。 */
export interface Abilities {
	/** 開啟流程檔（選單、選檔欄位）。 */
	readonly openFile: Can;
	/** 新建。 */
	readonly newFlow: Can;
	/** 存檔（上方列、選單）；不能存的上方列那格換成「首頁」。 */
	readonly save: Can;
	/** ☁ 傳上雲端（#259）。 */
	readonly upload: Can;
	/** ⤓ 下載成流程檔（#259）。 */
	readonly download: Can;
	/** 分享（每個人都有；不是擁有者打開的名單改不了）。 */
	readonly share: Can;
	/** 有練習頁（編排｜練習）。 */
	readonly practice: Can;
	/** 能記（練習的權限）。 */
	readonly record: Can;
	/** 名字旁寫「這台」（登入時的本機流程）。 */
	readonly here: Can;
	/** 能改編排（不能改的鎖成檢視模式）。 */
	readonly edit: Can;
	/** 存檔狀態的字。 */
	readonly status: SaveStatus;
}

const yes = (why: CanWhy): Can => ({ ok: true, why });
const no = (why: CanWhy): Can => ({ ok: false, why });

/**
 * 從來源算能做什麼。雲端流程、離線副本的權限、連線、存中都從 source.steps 讀（在 $derived 裡讀就跟著變）。
 * signedIn：登入了沒（傳上雲端、「這台」）；unsaved：有沒存的東西；practice：練習的權限。
 */
export function whatCanDo(source: FlowSource, signedIn: boolean, unsaved: boolean, practice: PracticeRights): Abilities {
	const record = (why: CanWhy) => (practice.cannotRecord ? no('practice_rights') : yes(why));
	if (source.kind === 'local') {
		const account = signedIn ? yes('local') : no('signed_out');
		const local = yes('local');
		return {
			openFile: local,
			newFlow: local,
			save: local,
			upload: account,
			download: no('local'),
			share: no('local'),
			practice: local,
			record: record('local'),
			here: account,
			edit: local,
			status: unsaved ? 'unsaved' : null
		};
	}
	if (source.kind === 'link') {
		const not = no('link_only');
		return {
			openFile: not,
			newFlow: not,
			save: not,
			upload: not,
			download: not,
			share: not,
			practice: not,
			record: not,
			here: not,
			edit: not,
			status: unsaved ? 'unsaved' : null
		};
	}
	const steps = source.steps;
	const kind = source.kind === 'offline' ? 'offline_copy' : 'cloud';
	const not = no(kind);
	const role = canEdit(steps.role) ? yes('owner_or_editor') : no('recorder_or_viewer');
	return {
		openFile: not,
		newFlow: not,
		save: not,
		upload: not,
		download: role,
		share: yes(kind),
		practice: yes(kind),
		record: record(kind),
		here: not,
		edit: steps.newVersion ? no('new_version') : steps.offline ? no('disconnected') : role,
		status: steps.offline ? (kind === 'offline_copy' ? 'offline_copy' : 'disconnected') : steps.newVersion ? null : steps.saving ? 'saving' : 'saved'
	};
}
