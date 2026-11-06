<script lang="ts" module>
	// 按鈕上的小圖示：24×24 的線條圖，顏色跟著文字。只是看的，名字寫在按鈕上或 aria-label。
	const PATHS = {
		play: 'M8 5.5v13l10.5-6.5z',
		pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
		save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
		open: 'M3 7V5h6l2 2h10v12H3zM3 9h18',
		new: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
		home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
		print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
		settings:
			'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
		metronome: 'M9 3h6l4 18H5zM12 17l4-9M8 15h8',
		repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
		close: 'M6 6l12 12M18 6L6 18',
		plus: 'M12 5v14M5 12h14',
		minus: 'M5 12h14',
		warn: 'M12 3l10 18H2zM12 10v5M12 18v.01',
		fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
		fitWidth: 'M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3',
		trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
		people:
			'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.6',
		bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
		undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
		redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
		eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
		pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
		help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.4v.6M12 17v.01'
	} as const;
	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let { name, size = 16 }: { name: IconName; size?: number } = $props();
	const filled = $derived(name === 'play' || name === 'pause');
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	aria-hidden="true"
	fill={filled ? 'currentColor' : 'none'}
	stroke={filled ? 'none' : 'currentColor'}
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"><path d={PATHS[name]} /></svg
>

<style>
	.icon {
		flex: none;
		display: block;
	}
</style>
