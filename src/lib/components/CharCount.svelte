<script lang="ts">
	// 欄位旁邊的字數（n/20），照看得到的字算；打到上限變紅。打（貼）太多時只留放得下的字，像原生的 maxlength，
	// 但一個家庭 emoji 算一個字。舊檔裡已經超過上限的字照留，只是不能比上次送出的更長（跟流程核心的 tooLong 同一條規則 charLimit，N08）；
	// 輸入法選字時先不管，選好再算。
	import { untrack } from 'svelte';
	import { MAX_CHARS, charCount, charLimit, charStart, firstChars, type LimitedText } from '#lib/core';

	interface Props {
		field: LimitedText;
		input: HTMLInputElement | HTMLTextAreaElement | undefined;
		/** 欄位現在該有的字（流程或草稿裡的）；換了就重算。 */
		value: string;
		/** 只在欄位有焦點時顯示（一整排名字時用）。 */
		quiet?: boolean;
	}

	let { field, input, value, quiet = false }: Props = $props();

	const uid = $props.id();
	let text = $state('');
	let focused = $state(false);
	const max = $derived(MAX_CHARS[field]);
	const n = $derived(charCount(text));
	/** 上一次留下來的字：新打的字從跟它不一樣的地方算起。 */
	let accepted = '';
	/** 上次送出（流程、草稿裡）的字：舊檔超過上限時，最多可以這麼長。 */
	let committed = '';

	$effect(() => {
		// 跟欄位上打的字一樣就是打字帶過來的（bind:value），不算換了。
		const v = value;
		if (v !== untrack(() => text)) text = accepted = committed = v;
	});

	$effect(() => {
		if (!input) return;
		const el = input;
		el.setAttribute('aria-describedby', uid);

		/** 正在離開欄位前切（beforechange 裡）。 */
		let changing = false;
		/** 太長就把這次打進去的字切到放得下（舊的字超過上限的話，至少保持上次送出的長度），再當作打了一次字。 */
		function clip() {
			const now = el.value;
			const limit = charLimit(field, committed);
			if (charCount(now) > limit) {
				const caret = el.selectionEnd ?? now.length;
				// 跟上次一樣的開頭：游標前多出來的那幾個一定是新打的，不能算進去；切在 emoji 中間就退到它前面。
				const grew = Math.max(0, now.length - accepted.length);
				let head = 0;
				while (head < caret - grew && now[head] === accepted[head]) head++;
				head = charStart(now, head);
				const tail = now.slice(caret);
				const typed = firstChars(now.slice(head, caret), limit - charCount(now.slice(0, head) + tail));
				el.value = now.slice(0, head) + typed + tail;
				el.setSelectionRange(head + typed.length, head + typed.length);
				el.dispatchEvent(new Event('input', { bubbles: true }));
			}
			accepted = el.value;
			// 離開欄位前切的（beforechange）不改狀態，等 window 的 onchange 晚一點再改。
			if (!changing) text = accepted;
		}
		// 輸入法選字中（compositionstart 到 compositionend）先只算字數，選好再切。
		let composing = false;
		const onstart = () => (composing = true);
		const onend = () => {
			composing = false;
			clip();
		};
		// capture：比欄位的 bind:value 先跑。不然瀏覽器在兩個 listener 之間跑 microtask，
		// 畫面先把打進去的字當成「欄位現在該有的字」帶回來，accepted 變成太長的字，就不切了（B20）。
		const oninput = () => (composing ? (text = el.value) : clip());
		// 離開欄位前先切：沒經過打字就變太長的字（自動填入之類）也照上限存，不整段被退回。
		// capture：比畫面的 onchange 先跑，切好的字照常送出。切了也只改欄位上的字、不碰狀態（畫面換掉時也會 change，那一刻不能改狀態）。
		const beforechange = () => {
			if (composing || charCount(el.value) <= charLimit(field, committed)) return;
			changing = true;
			clip();
			changing = false;
		};
		// 畫面在 change 時可能把欄位退回原本的字：等它退完再算。掛在 window，排在畫面的 onchange 後面
		// （只在 el 上排 microtask 不夠：瀏覽器在同一個事件的兩個 listener 之間就會跑 microtask，那時還沒退回）；
		// 再晚一個 microtask 才改狀態，理由同 onblur。
		const onchange = (e: Event) => {
			if (e.target === el) queueMicrotask(() => (text = accepted = committed = el.value));
		};
		const onfocus = () => (focused = true);
		// 晚一點才改：欄位可能是畫面換掉時才失去焦點，那一刻不能改狀態（B01）。
		const onblur = () => queueMicrotask(() => (focused = document.activeElement === el));
		el.addEventListener('input', oninput, true);
		el.addEventListener('compositionstart', onstart);
		el.addEventListener('compositionend', onend);
		el.addEventListener('change', beforechange, true);
		window.addEventListener('change', onchange);
		el.addEventListener('focus', onfocus);
		el.addEventListener('blur', onblur);
		return () => {
			el.removeEventListener('input', oninput, true);
			el.removeEventListener('compositionstart', onstart);
			el.removeEventListener('compositionend', onend);
			el.removeEventListener('change', beforechange, true);
			window.removeEventListener('change', onchange);
			el.removeEventListener('focus', onfocus);
			el.removeEventListener('blur', onblur);
		};
	});
</script>

<small class="char-count" class:full={n >= max} id={uid} hidden={quiet && !focused}>{n}/{max}</small>

<style>
	.char-count {
		color: var(--muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.full {
		color: var(--fail);
	}
</style>
