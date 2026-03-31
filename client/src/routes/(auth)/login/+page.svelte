<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { setMatrixLoggedIn } from '$lib/stores/auth';
	import { backend } from '$lib/services/activeBackend';

	let email = '';
	let password = '';
	let error = '';
	let notice = '';
	let loading = false;

	onMount(() => {
		notice = $page.url.searchParams.get('notice') || '';
	});

	async function handleSubmit() {
		error = '';
		loading = true;
		try {
			const d = await backend.login(email, password);
			setMatrixLoggedIn(d.user_id);
			await goto(resolve('/'));
		} catch (e) {
			if (e.code === 'reset_required') {
				await goto(resolve(`/forgot-password?email=${encodeURIComponent(email)}&required=1`));
				return;
			}
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="card auth-card">
	<div class="auth-brand">
		<img src="/logo.png" alt="" class="auth-logo" />
		<h1>FREE VOICE</h1>
	</div>
	<p class="text-secondary text-sm">{$t('signInSub')}</p>

	<form on:submit|preventDefault={handleSubmit}>
		<input
			type="text"
			bind:value={email}
			placeholder={$t('email')}
			required
			autocomplete="username"
		/>
		<input type="password" bind:value={password} placeholder={$t('password')} required />
		<button type="submit" class="btn-primary" disabled={loading}>
			{$t('signIn')}
		</button>
	</form>

	<p class="auth-link text-sm">
		<a href={resolve('/forgot-password')}>{$t('forgotPassword')}</a>
	</p>

	{#if notice}
		<p class="notice-msg">{notice}</p>
	{/if}

	{#if error}
		<p class="error-msg">{error}</p>
	{/if}

	<p class="auth-link text-sm">
		{$t('noAccount')} <a href={resolve('/register')}>{$t('register')}</a>
	</p>
</div>

<style>
	.auth-card {
		width: 360px;
		max-width: 90vw;
	}
	.auth-brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
	}
	.auth-logo {
		height: 36px;
	}
	.auth-brand h1 {
		font-size: 1.5rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 20px;
	}
	.notice-msg {
		color: var(--success, #4caf50);
		text-align: center;
		margin-top: 10px;
		font-size: 0.8125rem;
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
