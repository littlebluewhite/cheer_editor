// 殼在 document start 塞進網頁的（ShellCore/Bridge/BootScript.swift 把下面 var boot 的佔位字換成一開始塞的那份）。
// 網頁只認 window.__cheerShell（src/lib/app-shell.ts）：怎麼傳只有這裡和 App 的 WebShell 知道。
(function () {
	var boot = __BOOT__;
	var listeners = {};
	window.__cheerShell = Object.freeze({
		boot: boot,
		// 網頁 → 殼：回 Promise。殼回 {"reply": 值} 或 {"error": "unknown" | "failed" | "bad message"}
		send: function (name, body) {
			var message = JSON.stringify({ name: name, body: body === undefined ? null : body });
			return window.webkit.messageHandlers.shell.postMessage(message).then(function (raw) {
				var answer = JSON.parse(raw);
				if ('error' in answer) throw new Error(answer.error);
				return answer.reply;
			});
		},
		// 殼 → 網頁：on 回傳「不聽了」的函式
		on: function (name, fn) {
			(listeners[name] = listeners[name] || []).push(fn);
			return function () {
				listeners[name] = listeners[name].filter(function (f) {
					return f !== fn;
				});
			};
		},
		// 殼用 evaluateJavaScript 叫（Bridge.eventScript）
		receive: function (message) {
			(listeners[message.name] || []).slice().forEach(function (fn) {
				fn(message.body);
			});
		}
	});
})();
