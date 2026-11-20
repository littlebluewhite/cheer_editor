// 問教練 module：畫面上「送指令 → 問 → 再送」只寫這一次。一個實例管一個地方的問題，ConfirmList 收它就畫。
// 編輯頁的元件跟 session 要（changeAsk 是「改」、recordAsk 是「記」），不自己接；沒有 session 的（新建流程）才自己給 onchange。
// 送一個指令：給它指令名字＋參數（一步也可以帶好幾個，照順序跑、全算或全不算）。照結果：
//   成功：把新流程交給 onchange；被擋：留下原因（給了還原就加「，已還原」並還原）；要確認、要選：留下問題。
//   給了格名（field）：被擋的原因記在那一格（寫出哪一格退回），留到任何一格成功送出、或又要問為止（改好了就收，不疊著）。
// 送之前就看得出不行（表單的字讀不懂）：block 給原因，當被擋，不送指令。
// 回答取消：問題收掉，給了還原就還原（沒有原因），給了 cancel 也呼叫它（只有取消時）。
// 表單告訴它哪一格改了（edited）：收掉那一格的紅字，別格的留著。
// 給了鎖（locked，例：檢視模式）：鎖著時指令不送，直接當被擋，原因是鎖給的那句。
// 指令跑在 flow（建它時給的）那時候的流程上；回答放進要問的那個指令的 options，整串再送一次。
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
import type { Said } from '#lib/core';
import { reasonText } from '#lib/reason-text.js';

/** 教練的回答。 */
export type Answer = 'confirm' | 'keep' | 'clear' | 'cancel';

/** 等教練回答的問題：訊息、會被動到的清單、是不是要選（保留舊紀錄／清掉重算）、確定鈕的字（指令給的，沒給是這個 Ask 的）。 */
export interface Question {
	message: string;
	items: string[];
	choose: boolean;
	confirmLabel: string;
}

/** 送指令時可以給的事：成功之後再做什麼、怎麼還原畫面（被擋、取消時）、只在按取消時做什麼、
 *  是哪一格送的（給了就把原因記在那一格，留到改了那一格或有指令成功為止）、
 *  用哪個步驟 id（要先知道新東西的 id 的人自己發，例：音樂檔庫先算好音樂檔的 id 才傳上雲端；沒給就發一個新的）。 */
export interface Handlers<R extends CommandResult> {
	done?: (r: Extract<R, { kind: 'ok' }>) => void;
	revert?: () => void;
	cancel?: () => void;
	field?: string;
	stepId?: string;
}

/** 成功的一步送了什麼：步驟 id、一串指令（帶著教練的回答）。雲端流程把它送給伺服器（#248）。 */
export interface SentStep {
	id: string;
	commands: Command[];
}

/** 送一次指令：照回答跑；step 是最後一次跑的是哪一步（還沒到指令就被擋的沒有）。 */
interface Sender {
	(o: ConfirmOption): CommandResult;
	step?: () => SentStep;
}

const OPTIONS: Record<Exclude<Answer, 'cancel'>, ConfirmOption> = {
	confirm: { confirmed: true },
	keep: { records: 'keep' },
	clear: { records: 'clear' }
};

export class Ask {
	question = $state<Question | null>(null);
	error = $state('');
	/** 每一格被擋的原因（格名 → 原因）：教練改了那一格、任何一個指令成功、或又要問就收掉。 */
	fieldErrors = $state<Record<string, string>>({});
	/** 沒成功（被擋、要問）幾次：同一句原因又出現一次時，畫面靠它知道要再捲過去。 */
	failures = $state(0);
	/** 要確認時確定鈕的字（指令的結果自己帶了就用它的）。 */
	readonly confirmLabel: string;
	#onchange: (flow: Flow, step?: SentStep) => void;
	#onfail: ((error: string) => void) | undefined;
	#locked: (() => string) | undefined;
	#flow: () => Flow | null;
	#pending: { send: Sender; handlers: Handlers<CommandResult> } | null = null;

	/**
	 * onfail：沒成功（被擋、要問）之後呼叫，給 error（要問時是空的）。
	 * locked：鎖著的原因（空字串是沒鎖）；鎖著時送什麼都當被擋。
	 * flow：現在的流程，指令跑在它上面（沒給是 null，只有新建流程叫得動）。
	 * onchange 收新的流程和這一步送了什麼。
	 */
	constructor(
		onchange: (flow: Flow, step?: SentStep) => void,
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

	/** 送指令（名字＋參數，或一串指令）；回第一次送出的結果。 */
	send<N extends CommandName>(command: Command<N>, handlers?: Handlers<CommandOutcome<N>>): CommandOutcome<N>;
	send(commands: Command[], handlers?: Handlers<CommandResult>): CommandResult;
	send(what: object, handlers: Handlers<never> = {}): unknown {
		const send = this.#byName(what as Command | Command[], handlers.stepId);
		const r = this.#run(send, {});
		this.#settle(r, send, handlers as Handlers<CommandResult>);
		return r;
	}

	/** 送之前就看得出不行（例：表單的字讀不懂）：不送指令，當被擋，原因是 reason（鎖著時是鎖給的那句）。 */
	block(reason: string | Said, handlers: Handlers<CommandResult> = {}): CommandResult {
		const { message, why } = typeof reason === 'string' ? { message: reason } : reason;
		const send = (): CommandResult => ({ kind: 'blocked', message, ...(why && { why }) });
		const r = this.#run(send, {});
		this.#settle(r, send, handlers);
		return r;
	}

	/**
	 * 每次都跑在那時候的流程上。要問時記下是第幾個指令問的，
	 * 回答放進那個指令的 options（前面回答過的留著），整串再送一次。整串是同一步，用同一個步驟 id。
	 */
	#byName(what: Command | Command[], stepId = newStepId()): Sender {
		const single = !Array.isArray(what);
		let commands = single ? [what] : what;
		let asking = -1;
		const send: Sender = (o) => {
			if (asking >= 0) commands = commands.map((c, i) => (i === asking ? { ...c, options: o } : c));
			const flow = this.#flow();
			const r = single ? runCommand(flow, commands[0], stepId) : runCommands(flow, commands, stepId);
			asking = r.kind === 'confirm' || r.kind === 'choose' ? ('at' in r ? r.at : 0) : -1;
			return r;
		};
		send.step = () => ({ id: stepId, commands });
		return send;
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
	#run(send: Sender, o: ConfirmOption): CommandResult {
		const locked = this.#locked?.();
		return locked ? { kind: 'blocked', message: locked } : send(o);
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

	#settle(r: CommandResult, send: Sender, handlers: Handlers<CommandResult>) {
		this.clear();
		const field = handlers.field;
		if (r.kind === 'ok') {
			this.fieldErrors = {};
			this.#onchange(r.flow, send.step?.());
			handlers.done?.(r);
		} else if (r.kind === 'blocked') {
			const reason = reasonText(r);
			if (field !== undefined) this.fieldErrors[field] = `「${field}」退回原本的值：${reason}`;
			else this.error = handlers.revert ? `${reason}，已還原` : reason;
			handlers.revert?.();
		} else {
			// 要問了：舊的紅字收掉，確認框旁邊不留跟這次無關的原因。
			this.fieldErrors = {};
			const confirmLabel = (r.kind === 'confirm' && r.confirmLabel) || this.confirmLabel;
			this.question = { message: reasonText(r), items: r.items, choose: r.kind === 'choose', confirmLabel };
			this.#pending = { send, handlers };
		}
		if (r.kind !== 'ok') {
			this.failures++;
			this.#onfail?.(this.error);
		}
	}
}

/** 一步的步驟 id：12 個字的亂數（小寫字母、數字）。一步裡新東西的 id 由它算出來（ADR 0014）。 */
export function newStepId(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
}
