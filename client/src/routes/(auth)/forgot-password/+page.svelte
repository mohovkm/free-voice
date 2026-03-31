<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { post } from '$lib/services/api';

	let email = '';
	let error = '';
	let info = '';
	let loading = false;
	let resetRequired = false;

	onMount(() => {
		email = $page.url.searchParams.get('email') || '';
		resetRequired = $page.url.searchParams.get('required') === '1';
	});

	async function handleSubmit() {
		error = '';
		info = '';
		loading = true;
		try {
			const result = await post('/auth/password-reset/request', { email });
			info = result.detail || $t('resetPasswordEmailSent');
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="card auth-card">
	<h1>{$t('resetPasswordTitle')}</h1>
	<p class="text-secondary text-sm">
		{resetRequired ? $t('resetPasswordRequired') : $t('resetPasswordHelp')}
	</p>

	<form on:submit|preventDefault={handleSubmit}>
		<input
			type="email"
			bind:value={email}
			placeholder={$t('email')}
			required
			autocomplete="username"
		/>
		<button type="submit" class="btn-primary" disabled={loading}>
			{$t('sendResetLink')}
		</button>
	</form>

	{#if info}
		<p class="info-msg">{info}</p>
	{/if}

	{#if error}
		<p class="error-msg">{error}</p>
	{/if}

	<p class="auth-link text-sm">
		<a href={resolve('/login')}>{$t('signIn')}</a>
	</p>
</div>

<style>
	.auth-card {
		width: 360px;
		max-width: 90vw;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 20px;
	}
	.info-msg {
		color: var(--text);
		text-align: center;
		margin-top: 10px;
		font-size: 0.875rem;
	}
	.error-msg {
		color: var(--danger);
		text-align: center;
		margin-top: 10px;
		font-size: 0.8125rem;
	}
	.auth-link {
		text-align: center;
		margin-top: 16px;
		color: var(--text-muted);
	}
</style>
