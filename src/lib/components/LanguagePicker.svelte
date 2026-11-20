<script lang="ts">
	// 換語言（docs/adr/0017-i18n-paraglide-no-locale-in-url.md）：整頁重新載入，所以有還沒存的修改時不換。
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale, locales, setLocale, type Locale } from '#lib/paraglide/runtime.js';
	import { hasUnsavedChanges } from '#lib/unsaved.js';
	import { revealAlert } from './reveal.js';

	/** 每個語言用它自己的字寫，看不懂現在語言的人也找得到。 */
	const NAMES: Record<Locale, string> = { 'zh-TW': '中文', en: 'English' };

	let blocked = $state(false);

	function change(e: Event & { currentTarget: HTMLSelectElement }) {
		if (hasUnsavedChanges()) {
			e.currentTarget.value = getLocale();
			blocked = true;
			return;
		}
		void setLocale(e.currentTarget.value as Locale);
	}
</script>

<select class="language" aria-label={m.language()} value={getLocale()} onchange={change}>
	{#each locales as locale (locale)}
		<option value={locale}>{NAMES[locale]}</option>
	{/each}
</select>
{#if blocked}<p class="error" {@attach revealAlert(m.language_save_first())}>{m.language_save_first()}</p>{/if}

<style>
	.language {
		width: auto;
	}
</style>
