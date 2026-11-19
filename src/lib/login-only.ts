// 登入才用得到的頁（登入、帳號、管理使用者、忘記密碼、設密碼）的 load。
// 舊網址版（#267）不能登入：打開直接回首頁；建出來的那頁也只是轉址，沒有表單。
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { OLD_SITE } from '#lib/old-site.js';

export function loginOnly(): void {
	if (OLD_SITE) redirect(307, resolve('/'));
}
