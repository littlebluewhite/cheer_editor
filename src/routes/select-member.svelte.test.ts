// 點場上的人（#215）：泳道的名單捲到他那一行。
import { fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { editorPage } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView：記下被捲過去的元素。
const scrolled: Element[] = [];
Element.prototype.scrollIntoView = function () {
	scrolled.push(this);
};

beforeEach(() => {
	scrolled.length = 0;
});

const dot = (id: string) => document.querySelector(`[data-member-id="${id}"]`)!;
/** 捲過去的泳道是哪幾個人的。 */
const lanes = () => scrolled.map((el) => el.closest('[data-lane]')?.getAttribute('data-lane')).filter(Boolean);

async function click(id: string, shiftKey = false) {
	await fireEvent.pointerDown(dot(id), { clientX: 0, clientY: 0, button: 0, shiftKey });
	await fireEvent.pointerUp(dot(id), { clientX: 0, clientY: 0, shiftKey });
}

describe('點場上的人', () => {
	it('泳道捲到他那一行；Shift 加一個人，捲到加進來的那個', async () => {
		render(Page, editorPage(libSample()).props);
		await click('m4');
		expect(lanes()).toEqual(['m4']);
		await click('m2', true);
		expect(lanes()).toEqual(['m4', 'm2']);
	});
});
