// 測試用：import 這個檔，jsdom 拿掉有焦點的欄位時就跟 Chrome 一樣，當下發 change（字改過的話）、blur、focusout（jsdom 都不發）。
// 「拆掉有焦點的欄位會不會被當成送出」只有這樣才測得到（N06、B01）。

/** 有焦點的欄位上次送出（或拿到焦點）時的字：拿掉時字不一樣就跟離開欄位一樣發 change。 */
const lastSent = new WeakMap<EventTarget, string>();
for (const type of ['focusin', 'change'])
	window.addEventListener(type, (e) => lastSent.set(e.target!, (e.target as HTMLInputElement).value), true);
for (const [proto, name] of [
	[Element.prototype, 'remove'],
	[CharacterData.prototype, 'remove']
] as const) {
	const original = proto[name];
	proto[name] = function (this: ChildNode) {
		blurIfInside(this);
		original.call(this);
	};
}
const removeChild = Node.prototype.removeChild;
Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
	blurIfInside(child);
	return removeChild.call(this, child) as T;
};
function blurIfInside(node: Node) {
	const el = document.activeElement;
	if (el && el !== document.body && node.contains(el)) {
		const value = (el as HTMLInputElement).value;
		if (value !== undefined && value !== lastSent.get(el)) el.dispatchEvent(new Event('change', { bubbles: true }));
		el.dispatchEvent(new FocusEvent('blur'));
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	}
}
