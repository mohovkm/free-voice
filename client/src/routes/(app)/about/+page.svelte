<script>
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { ArrowLeft } from 'lucide-svelte';
</script>

<div class="page-header">
	<a href={resolve('/settings')} class="btn-icon" aria-label="Back"><ArrowLeft size={20} /></a>
	<h1>{$t('aboutTitle')}</h1>
</div>

<div class="about-content">
	<img src="/logo.png" alt="" class="about-logo" />
	<p>{$t('aboutText')}</p>
	<h3>{$t('aboutHow')}</h3>
	<p>{$t('aboutHowText')}</p>
	<p class="text-muted text-sm">{$t('aboutVersion')} 2.0</p>
</div>

<style>
	.page-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	h1 {
		font-size: 1.125rem;
	}
	.about-content {
		padding: 24px 16px;
		max-width: 480px;
	}
	.about-logo {
		height: 64px;
		margin-bottom: 16px;
	}
	p {
		line-height: 1.6;
		margin-bottom: 16px;
	}
	h3 {
		margin-bottom: 8px;
	}
</style>
