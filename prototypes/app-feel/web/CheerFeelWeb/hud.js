// 小樣（#300，比完就丟）：B 殼塞進網頁的量測小框。window.__shellState 由殼先給。
(() => {
	const S = window.__shellState;
	window.__appShell = true;
	window.__latencyFix = S.latencyFix;

	// 「扣輸出延遲」：WebKit 的 getOutputTimestamp 沒扣 outputLatency，畫面比喇叭早；開了就自己扣
	const AC = window.AudioContext || window.webkitAudioContext;
	let audio = null;
	if (AC && AC.prototype.getOutputTimestamp) {
		const orig = AC.prototype.getOutputTimestamp;
		AC.prototype.getOutputTimestamp = function () {
			audio = this;
			const ts = orig.call(this);
			if (!window.__latencyFix || !ts) return ts;
			return { contextTime: ts.contextTime - (this.outputLatency || 0), performanceTime: ts.performanceTime };
		};
	}

	// 一秒幾格、卡頓（比預期晚到的毫秒數，每秒加總）、最慢的一格
	let last = 0, frames = 0, late = 0, worst = 0, since = performance.now();
	let shown = { fps: 0, late: 0, worst: 0 };
	// 預期一格多久：上一秒超過 90 格就當 120 Hz，不然 60 Hz；比預期的 1.5 倍還久才算卡，卡的時間 = 多出來的
	let expect = 1000 / 60;
	function loop(t) {
		if (last) {
			const d = t - last;
			frames++;
			if (d > expect * 1.5) late += d - expect;
			worst = Math.max(worst, d);
		}
		last = t;
		if (t - since >= 1000) {
			const s = (t - since) / 1000;
			shown = { fps: Math.round(frames / s), late: late / s, worst };
			expect = 1000 / (shown.fps > 90 ? 120 : 60);
			frames = 0; late = 0; worst = 0; since = t;
			draw();
		}
		requestAnimationFrame(loop);
	}
	requestAnimationFrame(loop);

	let box;
	// service worker 有沒有、管不管這頁；空間是不是「不會被清」
	let extra = '';
	async function probe() {
		const sw = !('serviceWorker' in navigator) ? 'SW無' : navigator.serviceWorker.controller ? 'SW管' : 'SW沒管';
		let keep = '';
		try { keep = (await navigator.storage.persisted()) ? '存:不清' : '存:可清'; } catch { keep = '存:?'; }
		extra = `${sw} ${keep}`;
	}
	probe();
	setInterval(probe, 5000);
	const ms = (v) => (v == null ? '–' : Math.round(v * 1000) + 'ms');
	function draw() {
		if (!box) return;
		box.querySelector('[data-n]').textContent =
			`${shown.fps}格 卡${shown.late.toFixed(1)}ms/s 慢${Math.round(shown.worst)} ` +
			`延遲${ms(audio && audio.outputLatency)}/${ms(audio && audio.baseLatency)} ${extra}`;
		box.querySelector('[data-fix]').textContent = `扣延遲:${window.__latencyFix ? '開' : '關'}`;
	}
	function mount() {
		box = document.createElement('div');
		box.style.cssText =
			'position:fixed;left:2px;bottom:2px;z-index:2147483647;font:9px ui-monospace,monospace;white-space:nowrap;' +
			'background:rgba(0,0,0,.72);color:#7f7;padding:3px 6px;border-radius:6px;display:flex;gap:8px;align-items:center';
		box.innerHTML =
			`<span data-n></span><b data-fix style="color:#ff7"></b><b data-mode style="color:#7cf">${S.mode}</b>`;
		box.querySelector('[data-fix]').onclick = () => {
			window.__latencyFix = !window.__latencyFix;
			webkit.messageHandlers.shell.postMessage({ latencyFix: window.__latencyFix });
			draw();
		};
		box.querySelector('[data-mode]').onclick = () => webkit.messageHandlers.shell.postMessage({ toggleMode: true });
		document.documentElement.appendChild(box);
		draw();
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
	else mount();
})();
