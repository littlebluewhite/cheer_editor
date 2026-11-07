// 一步改到的東西（#254，ADR 0007、0011）：伺服器記下每一步改到哪些東西（keys），收到一步時查
// 「上次看到之後，別的分頁有沒有改過這一步要查的東西」（watch 跟別的分頁的 keys 有沒有重疊）。
// 鍵同 diffFlows；加了、刪了的隊員多記一個 `+member:<id>`（有沒有這個人）。
// 站位裡的一個人另外查那個隊員有沒有被別人加、刪：別人剛加的人，伺服器跑插站位這類指令時也被放進站位，
// 是我那邊沒看到的。只改隊員名字、只拖那個人不算同一個東西。

import { diffFlows } from './diff';
import type { Flow } from './flow';

/** keys：這一步記下的鍵；watch：收到這一步時要查別的分頁改過沒有的鍵。 */
export function stepKeys(before: Flow, after: Flow): { keys: string[]; watch: string[] } {
	const changes = diffFlows(before, after);
	const keys = changes.map((c) => c.key);
	const born = changes.filter((c) => c.key.startsWith('member:') && (c.before === null || c.after === null));
	const people = changes.flatMap((c) => (c.key.startsWith('pos:') ? [`+member:${c.key.split(':')[2]}`] : []));
	return {
		keys: [...keys, ...born.map((c) => `+${c.key}`)],
		watch: [...new Set([...keys, ...people])]
	};
}
