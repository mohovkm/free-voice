<script>
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { Play, Download } from 'lucide-svelte';
	import { getMediaUrl } from '$lib/services/backends/matrix/client';
	import { get as mediaCacheGet } from '$lib/services/mediaCache';
	import { MatrixTimelineType } from '$lib/types/matrix';

	/** @type {typeof MatrixTimelineType.IMAGE | typeof MatrixTimelineType.VIDEO} */
	export let type;
	/** @type {object} media object with mxcUrl, thumbnailUrl */
	export let media;
	/** @type {string} */
	export let alt = '';

	const dispatch = createEventDispatcher();

	let thumbSrc = null;
	let mediaExpired = false;
	let previewUnavailable = false;
	let _blobUrl = null; // blob URL we own (revoke on update/destroy)
	let _loadVersion = 0;

	$: loadThumb(media);

	async function loadThumb(m) {
		const version = ++_loadVersion;
		mediaExpired = false;
		previewUnavailable = false;

		const urlToLoad = m?.thumbnailUrl || (type !== MatrixTimelineType.VIDEO ? m?.mxcUrl : null);
		if (!urlToLoad) {
			thumbSrc = null;
			return;
		}

		// blob: URLs (local echo) — use directly, no fetch needed
		if (urlToLoad.startsWith('blob:')) {
			if (version !== _loadVersion) return;
			_revokeBlobUrl();
			thumbSrc = urlToLoad;
			return;
		}

		const httpUrl = getMediaUrl(urlToLoad);
		if (!httpUrl) {
			thumbSrc = null;
			return;
		}

		const blob = await mediaCacheGet(urlToLoad, httpUrl);
		if (version !== _loadVersion) return; // stale — media changed while loading

		if (!blob) {
			mediaExpired = true;
			thumbSrc = null;
			return;
		}

		_revokeBlobUrl();
		_blobUrl = URL.createObjectURL(blob);
		thumbSrc = _blobUrl;
	}

	function handleImageError() {
		thumbSrc = null;
		previewUnavailable = true;
	}

	function _revokeBlobUrl() {
		if (_blobUrl) {
			URL.revokeObjectURL(_blobUrl);
			_blobUrl = null;
		}
	}

	onDestroy(_revokeBlobUrl);

	function handleClick() {
		dispatch('open');
	}

	async function handleDownload(e) {
		e.stopPropagation();
		if (!media?.mxcUrl || media.mxcUrl.startsWith('blob:')) return;
		const httpUrl = getMediaUrl(media.mxcUrl);
		if (!httpUrl) return;
		const blob = await mediaCacheGet(media.mxcUrl, httpUrl);
		if (!blob) return;
		const ext = blob.type.split('/')[1]?.split(';')[0] || 'jpg';
		const filename = media.filename || 'image.' + ext;
		const file = new File([blob], filename, { type: blob.type });
		if (navigator.canShare?.({ files: [file] })) {
			try {
				await navigator.share({ files: [file], title: filename });
			} catch {}
			return; // don't fall through — cancel must not trigger <a download> on iOS
		}
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="media-thumb-wrap">
	<button
		class="media-thumb"
		aria-label="Open {type}"
		on:click={handleClick}
		disabled={mediaExpired}
	>
		{#if mediaExpired}
			<div class="thumb-placeholder thumb-expired">
				<span class="expired-text">Media expired</span>
			</div>
		{:else if previewUnavailable}
			<div class="thumb-placeholder thumb-unavailable">
				<span class="expired-text">Preview unavailable</span>
			</div>
		{:else if thumbSrc}
			<img src={thumbSrc} {alt} class="thumb-img" loading="lazy" on:error={handleImageError} />
		{:else}
			<div class="thumb-placeholder">
				{#if type === MatrixTimelineType.VIDEO}<Play size={28} />{:else}🖼{/if}
			</div>
		{/if}
		{#if type === MatrixTimelineType.VIDEO && !mediaExpired}
			<div class="play-overlay"><Play size={24} /></div>
		{/if}
	</button>
	{#if type === MatrixTimelineType.IMAGE && media?.mxcUrl && !media.mxcUrl.startsWith('blob:') && !mediaExpired}
		<button class="download-btn" aria-label="Download image" on:click={handleDownload}>
			<Download size={16} />
		</button>
	{/if}
</div>

<style>
	.media-thumb-wrap {
		position: relative;
		display: inline-block;
		flex-shrink: 0;
	}
	.media-thumb {
		display: block;
		width: 200px;
		height: 150px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-tertiary);
		border: none;
		padding: 0;
		cursor: pointer;
		position: relative;
	}
	.thumb-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.thumb-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		color: var(--text-muted);
	}
	.thumb-expired {
		font-size: 0.75rem;
	}
	.thumb-unavailable {
		font-size: 0.75rem;
	}
	.expired-text {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-align: center;
		padding: 4px;
	}
	.download-btn {
		position: absolute;
		bottom: 6px;
		right: 6px;
		z-index: 1;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.download-btn:hover {
		background: rgba(0, 0, 0, 0.75);
	}
	.play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
		color: #fff;
	}
</style>
