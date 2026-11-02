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

	it('取名字後建立，預設是 9 條直放', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '2027 全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).toHaveBeenCalledWith(expect.objectContaining({
			name: '2027 全國賽',
			field: { strips: 9, layout: 'vertical' }
		}));
	});

	it('選 5 條橫放', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '臺灣盃' } });
		await fireEvent.click(screen.getByRole('radio', { name: /5 條橫放/ }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).toHaveBeenCalledWith(expect.objectContaining({
			name: '臺灣盃',
			field: { strips: 5, layout: 'horizontal' }
		}));
	});

	it('自訂條數和鋪向', async () => {
		const { oncreate } = setup();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '校內賽' } });
		await fireEvent.click(screen.getByRole('radio', { name: /自訂/ }));
		await fireEvent.input(screen.getByLabelText('條數'), { target: { value: '7' } });
		await fireEvent.click(screen.getByRole('radio', { name: '橫放' }));
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(oncreate).toHaveBeenCalledWith(expect.objectContaining({
			name: '校內賽',
			field: { strips: 7, layout: 'horizontal' }
		}));
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
});
