<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { post } from '$lib/services/api';

	let token = '';
	let password = '';
	let confirmPassword = '';
	let error = '';
	let loading = false;

	onMount(() => {
		token = $page.url.searchParams.get('token') || '';
		if (!token) {
			error = $t('resetPasswordMissing');
		}
	});

	async function handleSubmit() {
		error = '';
		if (!token) {
			error = $t('resetPasswordMissing');
			return;
		}
		if (password !== confirmPassword) {
			error = $t('resetPasswordMismatch');
			return;
		}
		loading = true;
		try {
			await post('/auth/password-reset/confirm', { token, new_password: password });
			await goto(resolve(`/login?notice=${encodeURIComponent($t('resetPasswordNotice'))}`));
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="card auth-card">
	<h1>{$t('resetPasswordTitle')}</h1>
	<p class="text-secondary text-sm">{$t('resetPasswordChoose')}</p>

	<form on:submit|preventDefault={handleSubmit}>
		<input
			type="password"
			bind:value={password}
			placeholder={$t('newPassword')}
			required
			minlength="6"
		/>
		<input
			type="password"
			bind:value={confirmPassword}
			placeholder={$t('confirmPassword')}
			required
			minlength="6"
		/>
		<button type="submit" class="btn-primary" disabled={loading || !token}>
			{$t('save')}
		</button>
	</form>

	{#if error}
		<p class="error-msg">{error}</p>
	{/if}
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
.error-msg {
		color: var(--danger);
		text-align: center;
		margin-top: 10px;
		font-size: 0.8125rem;
	}
</style>
