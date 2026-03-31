<script>
	/** @type {string} */
	export let name = '';
	/** @type {number} */
	export let size = 40;
	/** @type {boolean} */
	export let online = false;

	$: initials = name
		? name
				.split(' ')
				.map((w) => w[0])
				.join('')
				.slice(0, 2)
				.toUpperCase()
		: '?';
	$: hue = name ? [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360 : 0;
</script>

<div
	class="avatar"
	style="width:{size}px;height:{size}px;font-size:{size * 0.4}px;background:hsl({hue},45%,35%)"
>
	{initials}
	{#if online}<span class="online-dot"></span>{/if}
</div>

<style>
	.avatar {
		position: relative;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		font-weight: 600;
		flex-shrink: 0;
		user-select: none;
	}
	.online-dot {
		position: absolute;
		bottom: 2px;
		right: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #22c55e;
		border: 2px solid var(--surface, #fff);
	}
</style>
