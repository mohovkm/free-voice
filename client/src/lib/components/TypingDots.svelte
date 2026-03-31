<script>
	import { onMount, onDestroy } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { sineInOut } from 'svelte/easing';

	const STEP_MS = 600;

	const d1 = tweened(0.25, { duration: STEP_MS, easing: sineInOut });
	const d2 = tweened(0.25, { duration: STEP_MS, easing: sineInOut });
	const d3 = tweened(0.25, { duration: STEP_MS, easing: sineInOut });

	const dots = [d1, d2, d3];
	let active = 0;
	let timer;

	function tick() {
		dots[active].set(0.25);
		active = (active + 1) % 3;
		dots[active].set(1);
	}

	onMount(() => {
		d1.set(1);
		timer = setInterval(tick, STEP_MS);
	});

	onDestroy(() => clearInterval(timer));
</script>

<span class="dot" style="opacity: {$d1}"></span>
<span class="dot" style="opacity: {$d2}"></span>
<span class="dot" style="opacity: {$d3}"></span>

<style>
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
	}
</style>
