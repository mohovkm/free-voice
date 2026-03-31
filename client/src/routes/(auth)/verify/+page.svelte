<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { login } from '$lib/stores/auth';
	import { post } from '$lib/services/api';

	let status = 'verifying';
	let message = '';

	onMount(async () => {
		const token = $page.url.searchParams.get('token') || '';
		if (!token) {
			status = 'error';
			message = $t('verifyEmailMissing');
			return;
		}
		try {
			const d = await post('/auth/verify', { token });
			login(d.access_token, d.refresh_token);
			await goto(resolve('/guide'));
		} catch (e) {
			status = 'error';
			message = e.message;
		}
	});
</script>

<div class="card auth-card">
	<h1>{$t('verifyEmailTitle')}</h1>
	{#if status === 'verifying'}
		<p class="info-msg">{$t('verifyEmailWorking')}</p>
	{:else}
		<p class="error-msg">{message || $t('verifyEmailFailed')}</p>
		<a class="btn-primary" href={resolve('/login')}>{$t('signIn')}</a>
	{/if}
</div>

<style>
	.auth-card {
		width: 360px;
		max-width: 90vw;
	}
	.info-msg {
		color: var(--text);
		text-align: center;
		margin: 16px 0 8px;
		font-size: 0.875rem;
	}
	.error-msg {
		color: var(--danger);
		text-align: center;
		margin: 10px 0 16px;
		font-size: 0.8125rem;
	}
	.btn-primary {
		display: inline-block;
		text-align: center;
	}
</style>
