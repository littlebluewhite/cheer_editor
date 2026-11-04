// 問教練 module：畫面上「送指令 → 問 → 再送」只寫這一次。一個實例管一個地方的問題，ConfirmList 收它就畫。
// 送一個指令（給它「帶著回答再送一次」的函式），照結果：
//   成功：把新流程交給 onchange；被擋：留下原因（給了還原就加「，已還原」並還原）；要確認、要選：留下問題。
// 回答取消：問題收掉，給了還原就還原（沒有原因），給了 cancel 也呼叫它（只有取消時）。

import type { CommandResult, ConfirmOption, Flow } from '#lib/core';

/** 教練的回答。 */
export type Answer = 'confirm' | 'keep' | 'clear' | 'cancel';

/** 等教練回答的問題：訊息、會被動到的清單、是不是要選（保留舊紀錄／清掉重算）。 */
export interface Question {
	message: string;
	items: string[];
	choose: boolean;
}

/** 送指令時可以給的事：成功之後再做什麼、怎麼還原畫面（被擋、取消時）、只在按取消時做什麼。 */
export interface Handlers<R extends CommandResult> {
	done?: (r: Extract<R, { kind: 'ok' }>) => void;
	revert?: () => void;
	cancel?: () => void;
}

const OPTIONS: Record<Exclude<Answer, 'cancel'>, ConfirmOption> = {
	confirm: { confirmed: true },
	keep: { records: 'keep' },
	clear: { records: 'clear' }
};

export class Ask {
	question = $state<Question | null>(null);
	error = $state('');
	/** 要確認時確定鈕的字。 */
	readonly confirmLabel: string;
	#onchange: (flow: Flow) => void;
	#onfail: ((error: string) => void) | undefined;
	#pending: { send: (o: ConfirmOption) => CommandResult; handlers: Handlers<CommandResult> } | null = null;

	/** onfail：沒成功（被擋、要問）之後呼叫，給 error（要問時是空的）。 */
	constructor(
		onchange: (flow: Flow) => void,
		{ confirmLabel = '確定', onfail }: { confirmLabel?: string; onfail?: (error: string) => void } = {}
	) {
		this.#onchange = onchange;
		this.#onfail = onfail;
		this.confirmLabel = confirmLabel;
	}

	/** 送指令；回第一次送出的結果。 */
	send<R extends CommandResult>(send: (o?: ConfirmOption) => R, handlers: Handlers<R> = {}): R {
		const r = send({});
		this.#settle(r, send, handlers as Handlers<CommandResult>);
		return r;
	}

	answer(answer: Answer) {
		const pending = this.#pending;
		if (!pending) return;
		if (answer === 'cancel') {
			this.clear();
			pending.handlers.revert?.();
			pending.handlers.cancel?.();
			return;
		}
		this.#settle(pending.send(OPTIONS[answer]), pending.send, pending.handlers);
	}

	/** 原因和問題都收掉（例：換了動作）。 */
	clear() {
		this.question = null;
		this.error = '';
		this.#pending = null;
	}

	#settle(r: CommandResult, send: (o: ConfirmOption) => CommandResult, handlers: Handlers<CommandResult>) {
		this.clear();
		if (r.kind === 'ok') {
			this.#onchange(r.flow);
			handlers.done?.(r);
		} else if (r.kind === 'blocked') {
			this.error = handlers.revert ? `${r.message}，已還原` : r.message;
			handlers.revert?.();
		} else {
			this.question = { message: r.message, items: r.items, choose: r.kind === 'choose' };
			this.#pending = { send, handlers };
		}
		if (r.kind !== 'ok') this.#onfail?.(this.error);
	}
}
