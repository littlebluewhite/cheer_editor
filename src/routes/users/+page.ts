import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { host } from '#lib/host.js';
import { loginOnly } from '#lib/login-only.js';

/** 管理使用者頁在 App 裡藏起來（#380）：網址也進不去，回首頁。管理要在網頁版做。 */
export function load(): void {
	loginOnly();
	if (host().shell.inApp) redirect(307, resolve('/'));
}
