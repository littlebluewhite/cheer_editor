// 量「這一步收不收」在 QuickJS 要多久用的大流程（#315）：照 docs/research/run-ts-core-on-server.md 的做法，
// 36 人、80 個動作（每個 3 個環節、兩組）、80 張站位；紀錄取 5,500 次，讓整支（含紀錄）約 1 MB
// （研究用的是 8,000 次，可是這裡一次的 JSON 比較大，8,000 次會到 1.46 MB）。
// 用流程核心自己的指令做（全域變數 flowCore），不手寫流程的樣子。
// bigFlow() 回 { flow, records }：伺服器存的樣子（不帶紀錄的編排、分開存的紀錄，ADR 0011）。
function bigFlow() {
	const C = flowCore;
	let n = 0;
	const run = (flow, commands) => {
		const r = C.runCommands(flow, commands, 'fixture' + n++);
		if (r.kind !== 'ok') throw new Error(JSON.stringify(r).slice(0, 300));
		return r.flow;
	};
	let f = run(null, [{ name: 'createFlow', args: [{ name: '大流程', field: { strips: 9, layout: 'vertical' } }] }]);
	const people = [];
	for (let i = 0; i < 36; i++) people.push({ name: '隊員' + i, gender: i % 2 ? 'M' : 'F', globalRole: i % 2 ? 'base' : 'top' });
	f = run(f, [{ name: 'addMembers', args: [people] }]);
	f = run(f, [{ name: 'addSegment', args: ['music'] }]);
	const seg = f.segments[0].id;
	f = run(f, [{ name: 'updateSegment', args: [seg, { eights: 190, lastBeats: 8 }] }]);
	const ids = f.members.map((m) => m.id);
	const roles = ['上層', '主底', '主底', '上層'];
	for (let k = 0; k < 80; k++) {
		const four = [0, 1, 2, 3].map((j) => ids[(k * 4 + j) % 36]);
		const input = {
			segmentId: seg,
			category: 'stunt',
			name: '動作' + k,
			start: k * 16,
			length: 16,
			note: '',
			members: four.map((memberId, j) => ({ memberId, role: roles[j] }))
		};
		f = run(f, [{ name: 'addAction', args: [input] }]);
		const x = f.actions[f.actions.length - 1].id;
		f = run(f, [
			{ name: 'addPhase', args: [x, { kind: 'load', name: '', beats: { at: 0, len: 4 } }] },
			{ name: 'addPhase', args: [x, { kind: 'hold', name: '', beats: { at: 4, len: 8 } }] },
			{ name: 'addPhase', args: [x, { kind: 'dismount', name: '', beats: { at: 12, len: 4 } }] },
			{ name: 'setSquad', args: [x, [four[0], four[1]], 1] },
			{ name: 'setSquad', args: [x, [four[2], four[3]], 2] }
		]);
	}
	for (let k = 0; f.formations.length < 80; k++) f = run(f, [{ name: 'insertFormation', args: [3 + k * 4] }]);
	for (const [i, fm] of f.formations.entries()) {
		const pos = {};
		ids.forEach((id, j) => (pos[id] = [((j % 9) + (i % 3) * 0.25) % 9, Math.floor(j / 9) * 2 + 0.5]));
		f = run(f, [{ name: 'setPositions', args: [fm.id, pos] }]);
	}
	const marks = ['✓', '△', '✗'];
	const records = [];
	for (let r = 0; r < 5500; r++) {
		const a = f.actions[r % 80];
		const squads = [...new Set(a.members.map((m) => m.squad))];
		const m = {};
		a.successRate.phases.forEach((p, j) => (m[p.id] = marks[(r + j) % 3]));
		const id = 'r' + (1e15 + r).toString(36).slice(-12);
		const date = '2026-11-' + String((r % 20) + 1).padStart(2, '0');
		records.push({ actionId: a.id, attempt: { id, date, who: squads[r % 2], practice: 'drill', whole: true, marks: m } });
	}
	return { flow: f, records };
}
