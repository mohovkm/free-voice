<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { Download } from 'lucide-svelte';
	import { getMediaUrl } from '$lib/services/backends/matrix/client';
	import { get as mediaCacheGet } from '$lib/services/mediaCache';

	/** @type {import('../stores/matrixStore').MediaInfo} */
	export let media;
	/** @type {boolean} auto-load and play when mounted (used in modal) */
	export let autoplay = false;

	let blobUrl = null;
	let blobMimeType = ''; // tracked separately so <source type> is correct
	let _ownedBlobUrl = null; // blob URL we created; must revoke in onDestroy
	let loading = false;
	let error = false;

	// True when running as an iOS home-screen PWA (navigator.standalone).
	// Blob URLs sourced from IndexedDB are unreliable in this context, so we
	// disable the direct-URL timeout fallback (which would also fail without cookies).
	const isIOSPWA = typeof window !== 'undefined' && !!window.navigator.standalone;

	$: httpUrl = media?.mxcUrl
		? (media.mxcUrl.startsWith('blob:') ? media.mxcUrl : getMediaUrl(media.mxcUrl))
		: null;
	$: posterUrl = media?.thumbnailUrl ? getMediaUrl(media.thumbnailUrl) : null;

	async function loadVideo() {
		if (!httpUrl || blobUrl || loading) return;
		// blob: URLs (local echoes) can be used directly
		if (httpUrl.startsWith('blob:')) { blobUrl = httpUrl; return; }
		loading = true;
		try {
			// 3s window: serves instant in-memory/IDB hits immediately.
			// If the download takes longer (large video on desktop), fall back to the
			// direct URL so the video starts streaming rather than waiting.
			// On iOS PWA the direct URL fallback is unreliable (cookie/CORS issues),
			// so keep waiting for the blob in that context.
			const result = await Promise.race([
				mediaCacheGet(media.mxcUrl, httpUrl),
				new Promise(resolve => setTimeout(() => resolve('__timeout__'), 3_000))
			]);
			if (result === '__timeout__') {
				if (isIOSPWA) {
					// Keep waiting — direct URL won't work in PWA sandbox.
					// mediaCache.get() is still running; wait for it fully.
					const blob = await mediaCacheGet(media.mxcUrl, httpUrl);
					if (!blob) { error = true; return; }
					blobMimeType = blob.type || 'video/mp4';
					_ownedBlobUrl = URL.createObjectURL(blob);
					await tick(); // let Svelte mount <video> before assigning src
					blobUrl = _ownedBlobUrl;
				} else {
					blobUrl = httpUrl; // stream directly on desktop; cache populates in background
				}
			} else if (result === null) {
				error = true;
			} else {
				blobMimeType = result.type || 'video/mp4';
				_ownedBlobUrl = URL.createObjectURL(result);
				await tick(); // let Svelte mount <video> before assigning src
				blobUrl = _ownedBlobUrl;
			}
		} catch {
			error = true;
		} finally {
			loading = false;
		}
	}

	async function shareVideo() {
		const mxcUrl = media?.mxcUrl;
		if (!mxcUrl || mxcUrl.startsWith('blob:')) return;
		const http = httpUrl;
		if (!http) return;
		const blob = await mediaCacheGet(mxcUrl, http);
		if (!blob) return;
		const ext = blob.type.split('/')[1]?.split(';')[0] || 'mp4';
		const filename = media.filename || ('video.' + ext);
		const file = new File([blob], filename, { type: blob.type });
		if (navigator.canShare?.({ files: [file] })) {
			try { await navigator.share({ files: [file], title: filename }); } catch {}
			return; // don't fall through — cancel must not trigger <a download> on iOS
		}
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	onMount(() => { if (autoplay) loadVideo(); });

	onDestroy(() => {
		if (_ownedBlobUrl) URL.revokeObjectURL(_ownedBlobUrl);
	});
</script>

<div class="video-wrapper">
	{#if blobUrl}
		<!-- Use <source> instead of src= — more reliable for blob URLs on iOS PWA.
		     webkit-playsinline is required on older iOS (< 10) in addition to playsinline. -->
		<video poster={posterUrl} controls {autoplay} playsinline webkit-playsinline
			preload="metadata" class="video-player">
			<source src={blobUrl} type={blobMimeType || undefined} />
		</video>
		{#if media?.mxcUrl && !media.mxcUrl.startsWith('blob:')}
			<button class="video-dl-btn" aria-label="Save video" on:click={shareVideo}>
				<Download size={14} />
			</button>
		{/if}
	{:else if error}
		<div class="placeholder expired">Media expired</div>
	{:else}
		<button class="poster-btn" aria-label="Play video" on:click={loadVideo} disabled={loading}>
			{#if posterUrl}
				<img src={posterUrl} alt="Video thumbnail" class="poster-img" />
			{:else}
				<div class="poster-placeholder">▶</div>
			{/if}
			{#if loading}<span class="spinner-sm"></span>{/if}
		</button>
	{/if}
</div>

<style>
	.video-wrapper {
		max-width: 280px;
		position: relative;
	}
	.video-dl-btn {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 1;
	}
	.video-dl-btn:hover { background: rgba(0, 0, 0, 0.75); }
	.video-player {
		width: 100%;
		border-radius: var(--radius-sm);
		/* Suppress double-tap zoom so single tap reaches the native controls */
		touch-action: manipulation;
	}
	.poster-btn {
		position: relative;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: block;
		width: 100%;
	}
	.poster-img {
		width: 100%;
		border-radius: var(--radius-sm);
		display: block;
	}
	.poster-placeholder {
		width: 160px;
		height: 90px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		color: var(--text-muted);
	}
	.placeholder {
		font-size: 0.8125rem;
		color: var(--text-muted);
		font-style: italic;
	}
	.expired {
		padding: 8px;
	}
	.spinner-sm {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 28px;
		height: 28px;
		border: 2px solid rgba(255,255,255,0.4);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to { transform: translate(-50%, -50%) rotate(360deg); }
	}
</style>
