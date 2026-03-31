<script>
	/** @type {string} */
	export let body = '';
</script>

<div class="system-message" aria-label={body}>{body}</div>

<style>
	.system-message {
		align-self: center;
		font-size: 0.75rem;
		color: var(--text-muted);
		text-align: center;
		padding: 2px 12px;
		font-style: italic;
	}
</style>
