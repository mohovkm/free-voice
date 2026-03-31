<div class="auth-shell">
	<slot />
</div>

<style>
	.auth-shell {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		min-height: 100vh;
		padding: 16px;
		padding-top: calc(16px + env(safe-area-inset-top));
	}
</style>
