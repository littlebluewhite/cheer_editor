// 問教練 module：畫面上「送指令 → 問 → 再送」只寫這一次。一個實例管一個地方的問題，ConfirmList 收它就畫。
// 編輯頁的元件跟 session 要（changeAsk 是「改」、recordAsk 是「記」），不自己接；沒有 session 的（新建流程）才自己給 onchange。
// 送一個指令：給它指令名字＋參數（一步也可以帶好幾個，照順序跑、全算或全不算），或「帶著回答再送一次」的函式。照結果：
//   成功：把新流程交給 onchange；被擋：留下原因（給了還原就加「，已還原」並還原）；要確認、要選：留下問題。
//   給了格名（field）：被擋的原因記在那一格（寫出哪一格退回），留到任何一格成功送出為止（改好了就收，不疊著）。
// 送之前就看得出不行（表單的字讀不懂）：block 給原因，當被擋，不送指令。
// 回答取消：問題收掉，給了還原就還原（沒有原因），給了 cancel 也呼叫它（只有取消時）。
// 表單告訴它哪一格改了（edited）：收掉那一格的紅字，別格的留著。
// 給了鎖（locked，例：檢視模式）：鎖著時指令不送，直接當被擋，原因是鎖給的那句。
// 用名字送的指令跑在 flow（建它時給的）那時候的流程上；回答放進要問的那個指令的 options，整串再送一次。
// 還沒到指令就被擋（例：教練打的字看不懂）用 block：跟送出被擋一樣留下原因。

import {
	runCommand,
	runCommands,
	type Command,
	type CommandName,
	type CommandOutcome,
	type CommandResult,
	type ConfirmOption,
	type Flow
} from '#lib/core';

/** 教練的回答。 */
export type Answer = 'confirm' | 'keep' | 'clear' | 'cancel';

/** 等教練回答的問題：訊息、會被動到的清單、是不是要選（保留舊紀錄／清掉重算）。 */
export interface Question {
	message: string;
	items: string[];
	choose: boolean;
}

/** 送指令時可以給的事：成功之後再做什麼、怎麼還原畫面（被擋、取消時）、只在按取消時做什麼、
 *  是哪一格送的（給了就把原因記在那一格，留到改了那一格或有指令成功為止）。 */
export interface Handlers<R extends CommandResult> {
	done?: (r: Extract<R, { kind: 'ok' }>) => void;
	revert?: () => void;
	cancel?: () => void;
	field?: string;
}

const OPTIONS: Record<Exclude<Answer, 'cancel'>, ConfirmOption> = {
	confirm: { confirmed: true },
	keep: { records: 'keep' },
	clear: { records: 'clear' }
};

export class Ask {
	question = $state<Question | null>(null);
	error = $state('');
	/** 每一格被擋的原因（格名 → 原因）：教練改了那一格、或任何一個指令成功就收掉。 */
	fieldErrors = $state<Record<string, string>>({});
	/** 沒成功（被擋、要問）幾次：同一句原因又出現一次時，畫面靠它知道要再捲過去。 */
	failures = $state(0);
	/** 要確認時確定鈕的字。 */
	readonly confirmLabel: string;
	#onchange: (flow: Flow) => void;
	#onfail: ((error: string) => void) | undefined;
	#locked: (() => string) | undefined;
	#flow: () => Flow | null;
	#pending: { send: (o: ConfirmOption) => CommandResult; handlers: Handlers<CommandResult> } | null = null;

	/**
	 * onfail：沒成功（被擋、要問）之後呼叫，給 error（要問時是空的）。
	 * locked：鎖著的原因（空字串是沒鎖）；鎖著時送什麼都當被擋。
	 * flow：現在的流程，用名字送的指令跑在它上面（沒給是 null，只有新建流程叫得動）。
	 */
	constructor(
		onchange: (flow: Flow) => void,
		{
			confirmLabel = '確定',
			onfail,
			locked,
			flow = () => null
		}: {
			confirmLabel?: string;
			onfail?: (error: string) => void;
			locked?: () => string;
			flow?: () => Flow | null;
		} = {}
	) {
		this.#onchange = onchange;
		this.#onfail = onfail;
		this.#locked = locked;
		this.#flow = flow;
		this.confirmLabel = confirmLabel;
	}

	/** 送指令（名字＋參數、一串指令，或包好的函式）；回第一次送出的結果。 */
	send<N extends CommandName>(command: Command<N>, handlers?: Handlers<CommandOutcome<N>>): CommandOutcome<N>;
	send(commands: Command[], handlers?: Handlers<CommandResult>): CommandResult;
	send<R extends CommandResult>(send: (o?: ConfirmOption) => R, handlers?: Handlers<R>): R;
	send(what: object, handlers: Handlers<never> = {}): unknown {
		const send =
			typeof what === 'function'
				? (what as (o?: ConfirmOption) => CommandResult)
				: this.#byName(what as Command | Command[]);
		const r = this.#run(send, {});
		this.#settle(r, send, handlers as Handlers<CommandResult>);
		return r;
	}

	/** 送之前就看得出不行（例：表單的字讀不懂）：不送指令，當被擋，原因是 message（鎖著時是鎖給的那句）。 */
	block(message: string, handlers: Handlers<CommandResult> = {}): CommandResult {
		const send = (): CommandResult => ({ kind: 'blocked', message });
		const r = this.#run(send, {});
		this.#settle(r, send, handlers);
		return r;
	}

	/**
	 * 用名字送：每次都跑在那時候的流程上。要問時記下是第幾個指令問的，
	 * 回答放進那個指令的 options（前面回答過的留著），整串再送一次。
	 */
	#byName(what: Command | Command[]): (o: ConfirmOption) => CommandResult {
		const single = !Array.isArray(what);
		let commands = single ? [what] : what;
		let asking = -1;
		return (o) => {
			if (asking >= 0) commands = commands.map((c, i) => (i === asking ? { ...c, options: o } : c));
			const flow = this.#flow();
			const r = single ? runCommand(flow, commands[0]) : runCommands(flow, commands);
			asking = r.kind === 'confirm' || r.kind === 'choose' ? ('at' in r ? r.at : 0) : -1;
			return r;
		};
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
		this.#settle(this.#run(pending.send, OPTIONS[answer]), pending.send, pending.handlers);
	}

	/** 送一次：鎖著就不送，當被擋。 */
	#run<R extends CommandResult>(send: (o: ConfirmOption) => R, o: ConfirmOption): R {
		const locked = this.#locked?.();
		return locked ? ({ kind: 'blocked', message: locked } as R) : send(o);
	}

	/** 教練改了一格：收掉那一格的紅字，別格的留著。
	 *  沒給格名：是整張表單送出（沒給 field）的那一格，收掉 error。 */
	edited(field?: string) {
		if (field === undefined) this.error = '';
		else delete this.fieldErrors[field];
	}

	/** 原因和問題都收掉（例：換了動作）。 */
	clear() {
		this.question = null;
		this.error = '';
		this.#pending = null;
	}

	#settle(r: CommandResult, send: (o: ConfirmOption) => CommandResult, handlers: Handlers<CommandResult>) {
		this.clear();
		const field = handlers.field;
		if (r.kind === 'ok') {
			this.fieldErrors = {};
			this.#onchange(r.flow);
			handlers.done?.(r);
		} else if (r.kind === 'blocked') {
			if (field !== undefined) this.fieldErrors[field] = `「${field}」退回原本的值：${r.message}`;
			else this.error = handlers.revert ? `${r.message}，已還原` : r.message;
			handlers.revert?.();
		} else {
			this.question = { message: r.message, items: r.items, choose: r.kind === 'choose' };
			this.#pending = { send, handlers };
		}
		if (r.kind !== 'ok') {
			this.failures++;
			this.#onfail?.(this.error);
		}
	}
}
