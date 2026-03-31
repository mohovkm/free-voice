<script>
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { get as apiGet, post as apiPost, del as apiDel } from '$lib/services/api';
	import { Plus, ExternalLink, XCircle } from 'lucide-svelte';

	let links = [];
	let loading = true;

	onMount(() => load());

	async function load() {
		loading = true;
		try {
			links = (await apiGet('/links')) || [];
		} catch (err) {
			console.warn(err);
		}
		loading = false;
	}

	async function createLink() {
		try {
			await apiPost('/links', {});
			await load();
		} catch (e) {
			alert(e.message);
		}
	}

	async function deactivate(slug) {
		try {
			await apiDel('/links/' + slug);
			await load();
		} catch (err) {
			console.warn(err);
		}
	}
</script>

<div class="page-header">
	<h1>{$t('links')}</h1>
	<button class="btn-secondary" on:click={createLink}>
		<Plus size={16} />
		{$t('createCallLink')}
	</button>
</div>

{#if loading}
	<div class="page-center"><p class="text-muted">...</p></div>
{:else if links.length === 0}
	<div class="page-center"><p class="text-muted">{$t('noLinks')}</p></div>
{:else}
	<div class="list">
		{#each links as l (l.slug)}
			<div class="list-item">
				<span class="item-name">{l.slug}</span>
				{#if l.active}
					<a
						href={resolve('/call/' + l.slug)}
						target="_blank"
						class="btn-icon"
						aria-label={$t('open')}
					>
						<ExternalLink size={18} />
					</a>
					<button
						class="btn-icon"
						on:click={() => deactivate(l.slug)}
						aria-label={$t('deactivate')}
					>
						<XCircle size={18} />
					</button>
				{:else}
					<span class="text-muted text-sm">{$t('inactive')}</span>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	h1 {
		font-size: 1.125rem;
	}
	.page-center {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.list {
		flex: 1;
		overflow-y: auto;
	}
	.list-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
	}
	.item-name {
		flex: 1;
		font-weight: 500;
	}
</style>
