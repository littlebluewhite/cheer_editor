// 慢速播放的拉長：把音樂拉成 1 / rate 倍長，音高不變（WSOLA：一小格一小格疊起來，每格挑跟上一格接得最順的位置）。
// AudioBufferSourceNode 的 playbackRate 會連音高一起變低，所以慢速播放先用這個拉好一份再照常排。純函式，在 Node 測。

/** 一格多長（秒）、在原位置前後找多遠（秒）。 */
const FRAME_SEC = 0.04;
const SEEK_SEC = 0.012;
/** 先在降取樣（每 STEP 點取平均）的聲音上粗找，再在原本的聲音上細找。 */
const STEP = 8;

/** 把每個聲道拉成 1 / rate 倍長（rate 0.5 是兩倍長）；所有聲道用同一組位置，左右才對得上。 */
export function stretch(channels: Float32Array[], sampleRate: number, rate: number): Float32Array<ArrayBuffer>[] {
	const length = channels[0]?.length ?? 0;
	const outLength = Math.ceil(length / rate);
	const out = channels.map(() => new Float32Array(outLength));
	const half = Math.max(STEP, Math.round((FRAME_SEC * sampleRate) / 2 / STEP) * STEP);
	const frame = half * 2;
	const seek = Math.round(SEEK_SEC * sampleRate);
	// 疊起來剛好加成 1 的窗（週期 Hann、重疊一半）
	const window = Float32Array.from({ length: frame }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / frame));
	const guide = mono(channels, length);
	const coarse = Float32Array.from({ length: Math.floor(length / STEP) }, (_, i) => {
		let sum = 0;
		for (let j = 0; j < STEP; j++) sum += guide[i * STEP + j];
		return sum / STEP;
	});
	const last = Math.max(0, length - frame);

	let prev = 0;
	for (let outAt = 0; outAt < outLength; outAt += half) {
		const nominal = Math.min(Math.round(outAt * rate), last);
		const from = outAt === 0 ? 0 : bestStart(prev + half, nominal);
		for (const [c, data] of channels.entries()) {
			const target = out[c];
			const n = Math.min(frame, outLength - outAt, length - from);
			for (let i = 0; i < n; i++) target[outAt + i] += window[i] * data[from + i];
		}
		prev = from;
	}
	return out;

	/** 在 nominal 前後 seek 點裡，挑開頭最像 natural（上一格自然接下去的那段）的位置。 */
	function bestStart(natural: number, nominal: number): number {
		if (natural + half > length) return nominal;
		const lo = Math.max(0, nominal - seek);
		const hi = Math.min(last, nominal + seek);
		let best = nominal;
		let bestScore = -Infinity;
		const n = half / STEP;
		const nat = Math.floor(natural / STEP);
		for (let s = Math.ceil(lo / STEP); s * STEP <= hi && s + n <= coarse.length && nat + n <= coarse.length; s++) {
			const score = correlate(coarse, s, coarse, nat, n, 1);
			if (score > bestScore) [bestScore, best] = [score, s * STEP];
		}
		const center = best;
		bestScore = -Infinity;
		for (let s = Math.max(lo, center - STEP); s <= Math.min(hi, center + STEP); s++) {
			const score = correlate(guide, s, guide, natural, half, 2);
			if (score > bestScore) [bestScore, best] = [score, s];
		}
		return best;
	}
}

function mono(channels: Float32Array[], length: number): Float32Array {
	if (channels.length === 1) return channels[0];
	const out = new Float32Array(length);
	for (const data of channels) for (let i = 0; i < length; i++) out[i] += data[i] / channels.length;
	return out;
}

function correlate(a: Float32Array, i: number, b: Float32Array, j: number, n: number, stride: number): number {
	let sum = 0;
	for (let k = 0; k < n; k += stride) sum += a[i + k] * b[j + k];
	return sum;
}
