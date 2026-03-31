<script>
	/** @type {number} */
	export let count = 0;
	/** @type {boolean} true = mention/highlight → red badge */
	export let highlight = false;
</script>

{#if count > 0}
	<span class="badge" class:highlight aria-label="{count} unread">{count > 99 ? '99+' : count}</span>
{/if}

<style>
	.badge {
		background: var(--badge-bg);
		color: var(--badge-text);
		font-size: 0.6875rem;
		font-weight: 600;
		min-width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
	}
	.badge.highlight {
		background: var(--danger);
	}
</style>
