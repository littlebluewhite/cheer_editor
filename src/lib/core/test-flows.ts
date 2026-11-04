// 核心測試共用的小工具和範例流程。只給測試 import，畫面不用。

import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	addPhase,
	setSquad,
	updateSegment,
	type CommandResult,
	type Flow
} from './index';

/** 拿出成功的流程；不是成功就讓測試失敗。 */
export function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 成功率的範例流程（ratedSample）的前半，只有技巧動作。
 * 音樂 1（4 個八拍）；隊員小美（上層）、小A、小B、小芳（上層）。
 * x1：Lib（技巧，第 1 個八拍），環節 p1 上法 1-1 到 1-2、p2 中段 1-3 到 1-6、p3 下法 1-7 到 1-8；小美、小A 第 1 組，小B、小芳 第 2 組。
 */
export function libSample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '主底' },
		{ memberId: 'm4', role: '上層' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 4, 8], ['dismount', 12, 4]] as const) {
		flow = flowOf(addPhase(flow, 'x1', { kind, name: '', beats: { at: at, len: len } }));
	}
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', [id], squad));
	}
	return flow;
}

/**
 * 成功率的範例流程：libSample 再加
 * x2：騰翻（第 3 個八拍），環節 p4 整體「騰翻」整個動作；小美、小A 在裡面。
 */
export function ratedSample(): Flow {
	const flow = flowOf(
		addAction(libSample(), {
			segmentId: 's1',
			category: 'tumbling',
			name: '',
			start: 32,
			length: 16,
			note: '',
			members: [
				{ memberId: 'm1', role: '騰翻' },
				{ memberId: 'm2', role: '騰翻' }
			]
		})
	);
	return flowOf(addPhase(flow, 'x2', { kind: 'whole', name: '騰翻', beats: { at: 0, len: 16 } }));
}
