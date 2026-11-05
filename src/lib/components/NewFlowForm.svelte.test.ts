import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Flow } from '#lib/core';
import NewFlowForm from './NewFlowForm.svelte';

function setup() {
	const oncreate = vi.fn<(flow: Flow) => void>();
	render(NewFlowForm, { oncreate });
	return { oncreate };
}

describe('新建流程', () => {
	it('三種場地旁邊都有小字說明', () => {
		setup();
		expect(screen.getByText('全國賽、中等學校、大專')).toBeTruthy();
		expect(screen.getByText('臺灣盃')).toBeTruthy();
		expect(screen.getByText('條數 1–12，鋪向直放或橫放')).toBeTruthy();
	});

	it('被擋下的原因，改了欄位就收掉', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(screen.getByRole('alert').textContent).toBe('請幫流程取名字');
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('取名字後建立，預設是 9 條直放', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '2027 全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: '2027 全國賽',
				field: { strips: 9, layout: 'vertical' }
			})
		);
	});

	it('選 5 條橫放', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		await fireEvent.click(screen.getByRole('radio', { name: /5 條橫放/ }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: '臺灣盃',
				field: { strips: 5, layout: 'horizontal' }
			})
		);
	});

	it('自訂條數和鋪向', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '校內賽' } });
		await fireEvent.click(screen.getByRole('radio', { name: /自訂/ }));
		await fireEvent.input(screen.getByLabelText('條數'), { target: { value: '7' } });
		await fireEvent.click(screen.getByRole('radio', { name: '橫放' }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: '校內賽',
				field: { strips: 7, layout: 'horizontal' }
			})
		);
	});

	it('流程核心擋下時顯示原因，不建立', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '校內賽' } });
		await fireEvent.click(screen.getByRole('radio', { name: /自訂/ }));
		await fireEvent.input(screen.getByLabelText('條數'), { target: { value: '13' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toBe('條數要是 1–12 的整數');
	});

	/** 選項上小場地圖的外框寬和高（所有條加起來）。 */
	function previewSize(option: RegExp) {
		const svg = screen.getByRole('radio', { name: option }).closest('label')!.querySelector('svg')!;
		const rects = [...svg.querySelectorAll('rect')].map((r) => ({
			x: Number(r.getAttribute('x')),
			y: Number(r.getAttribute('y')),
			w: Number(r.getAttribute('width')),
			h: Number(r.getAttribute('height'))
		}));
		if (!rects.length) return null;
		const w = Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x));
		const h = Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y));
		return { count: rects.length, ratio: w / h };
	}

	it('小場地圖照實際比例：9 條直放 9:7、5 條橫放 7:5', () => {
		setup();
		expect(previewSize(/9 條直放/)!.ratio).toBeCloseTo(9 / 7, 1);
		expect(previewSize(/5 條橫放/)!.ratio).toBeCloseTo(7 / 5, 1);
	});

	it('自訂的預覽照條數和鋪向：12 條直放 12:7、3 條橫放 7:3', async () => {
		setup();
		await fireEvent.click(screen.getByRole('radio', { name: /自訂/ }));
		await fireEvent.input(screen.getByLabelText('條數'), { target: { value: '12' } });
		expect(previewSize(/自訂/)).toEqual({ count: 12, ratio: expect.closeTo(12 / 7, 1) });
		await fireEvent.input(screen.getByLabelText('條數'), { target: { value: '3' } });
		await fireEvent.click(screen.getByRole('radio', { name: '橫放' }));
		expect(previewSize(/自訂/)).toEqual({ count: 3, ratio: expect.closeTo(7 / 3, 1) });
	});

	it('自訂條數超出 1–12 或沒填：不畫預覽，不用按建立就說原因', async () => {
		setup();
		await fireEvent.click(screen.getByRole('radio', { name: /自訂/ }));
		for (const bad of ['13', '0', '2.5', '']) {
			await fireEvent.input(screen.getByLabelText('條數'), { target: { value: bad } });
			expect(previewSize(/自訂/)).toBeNull();
			expect(screen.getByRole('alert').textContent).toBe('條數要是 1–12 的整數');
		}
		await fireEvent.input(screen.getByLabelText('條數'), { target: { value: '4' } });
		expect(screen.queryByRole('alert')).toBeNull();
		expect(previewSize(/自訂/)!.count).toBe(4);
	});
});
