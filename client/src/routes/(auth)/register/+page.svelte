<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { backend } from '$lib/services/activeBackend';
	import { setMatrixLoggedIn } from '$lib/stores/auth';

	let displayName = '';
	let email = '';
	let password = '';
	let error = '';
	let loading = false;

	async function handleSubmit() {
		error = '';
		loading = true;
		try {
			const d = await backend.register(email, password, displayName);
			setMatrixLoggedIn(d.user_id);
			goto(resolve('/'));
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="card auth-card">
	<h1>{$t('createAccount')}</h1>

	<form on:submit|preventDefault={handleSubmit}>
		<input type="text" bind:value={displayName} placeholder={$t('displayName')} required />
		<input
			type="text"
			bind:value={email}
			placeholder={$t('username')}
			required
			autocomplete="username"
		/>
		<input
			type="password"
			bind:value={password}
			placeholder={$t('password')}
			required
			minlength="6"
		/>
		<button type="submit" class="btn-primary" disabled={loading}>
			{$t('register')}
		</button>
	</form>

	{#if error}
		<p class="error-msg">{error}</p>
	{/if}

	<p class="auth-link text-sm">
		{$t('haveAccount')} <a href={resolve('/login')}>{$t('signIn')}</a>
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
