import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Field from './Field.svelte';

/** 場地上寫的條編號，照畫的順序。 */
function stripNumbers(): string[] {
	return Array.from(document.querySelectorAll('[data-strip-number]'), (el) => el.textContent ?? '');
}

describe('場地', () => {
	it('9 條直放畫出 9 條，編號 1–9', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		expect(stripNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
	});

	it('5 條橫放畫出 5 條', () => {
		render(Field, { field: { strips: 5, layout: 'horizontal' } });
		expect(stripNumbers()).toHaveLength(5);
	});

	it('正面在下面，標「正面／裁判」', () => {
		render(Field, { field: { strips: 9, layout: 'vertical' } });
		expect(screen.getByText(/正面／裁判/)).toBeTruthy();
	});
});
