<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';

	const stepKeys = [
		{ title: 'guideStep1Title', body: 'guideStep1' },
		{ title: 'guideStep2Title', body: 'guideStep2' },
		{ title: 'guideStep3Title', body: 'guideStep3' },
		{ title: 'guideStep4Title', body: 'guideStep4' },
		{ title: 'guideStep5Title', body: 'guideStep5' },
		{ title: 'guideStep6Title', body: 'guideStep6' },
		{ title: 'guideStep7Title', body: getInstallKey() },
		{ title: 'guideStep8Title', body: getNotifKey() }
	];

	let idx = 0;

	function getInstallKey() {
		if (typeof navigator === 'undefined') return 'guideStep7desktop';
		const ua = navigator.userAgent || '';
		if (/android/i.test(ua)) return 'guideStep7android';
		if (/iphone|ipad|ipod/i.test(ua)) return 'guideStep7ios';
		return 'guideStep7desktop';
	}

	function getNotifKey() {
		if (typeof navigator === 'undefined') return 'guideStep8other';
		if (/iphone|ipad|ipod/i.test(navigator.userAgent || '')) return 'guideStep8ios';
		return 'guideStep8other';
	}

	function finish() {
		localStorage.setItem('fv-guide-done', '1');
		goto(resolve('/'));
	}
</script>

<div class="guide-overlay">
	<div class="card guide-card">
		<div class="guide-progress text-muted text-sm">{idx + 1} / {stepKeys.length}</div>
		<h2>{$t(stepKeys[idx].title)}</h2>
		<p>{$t(stepKeys[idx].body)}</p>
		<div class="guide-nav">
			{#if idx > 0}
				<button class="btn-secondary" on:click={() => idx--}>{$t('guidePrev')}</button>
			{:else}
				<span></span>
			{/if}
			{#if idx < stepKeys.length - 1}
				<button class="btn-primary" on:click={() => idx++}>{$t('guideNext')}</button>
			{:else}
				<button class="btn-primary" on:click={finish}>{$t('guideDone')}</button>
			{/if}
		</div>
		<button class="skip-btn text-muted text-sm" on:click={finish}>{$t('guideSkip')}</button>
	</div>
</div>

<style>
	.guide-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--overlay);
		z-index: 100;
		padding: 16px;
	}
	.guide-card {
		width: 400px;
		max-width: 90vw;
		text-align: center;
	}
	.guide-progress {
		margin-bottom: 12px;
	}
	h2 {
		margin-bottom: 12px;
		font-size: 1.125rem;
	}
	p {
		line-height: 1.6;
		margin-bottom: 24px;
		color: var(--text-secondary);
	}
	.guide-nav {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.guide-nav button {
		flex: 1;
	}
	.skip-btn {
		display: block;
		margin: 16px auto 0;
		background: none;
	}
</style>
