<script>
	import { File } from 'lucide-svelte';
	import { getMediaUrl } from '$lib/services/backends/matrix/client';

	/** @type {import('../stores/matrixStore').MediaInfo} */
	export let media;

	$: downloadUrl = media?.mxcUrl ? getMediaUrl(media.mxcUrl) : null;
	$: label = media?.filename || 'File';
	$: sizeLabel = media?.size ? formatSize(media.size) : '';

	function formatSize(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function download() {
		if (!downloadUrl) return;
		const a = document.createElement('a');
		a.href = downloadUrl;
		a.download = label;
		a.click();
	}
</script>

<div class="file-attachment">
	<File size={20} />
	<div class="file-info">
		<span class="file-name">{label}</span>
		{#if sizeLabel}<span class="file-size">{sizeLabel}</span>{/if}
	</div>
	{#if downloadUrl}
		<button class="download-link btn-icon" aria-label="Download {label}" on:click={download}>↓</button>
	{/if}
</div>

<style>
	.file-attachment {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
	}
	.file-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.file-name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file-size {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.download-link {
		font-size: 1rem;
		color: var(--accent);
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
</style>
