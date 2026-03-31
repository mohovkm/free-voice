<script>
	import { createEventDispatcher } from 'svelte';
	import { X, Download, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { getMediaUrl } from '$lib/services/backends/matrix/client';
	import { get as mediaCacheGet } from '$lib/services/mediaCache';

	/** @type {Array<{mxcUrl: string, alt: string}>} all images in the gallery */
	export let images = [];
	/** @type {number} index of the initially shown image */
	export let index = 0;

	const dispatch = createEventDispatcher();
	let current = index;

	$: item = images[current] || null;
	$: src = item ? (item.mxcUrl.startsWith('blob:') ? item.mxcUrl : getMediaUrl(item.mxcUrl)) : '';
	$: alt = item?.alt || '';

	function close() { dispatch('close'); }
	function prev() { if (current > 0) current--; }
	function next() { if (current < images.length - 1) current++; }

	async function save() {
		// Get the blob: prefer cache hit (already loaded for display), fallback to fetch
		const mxcUrl = item?.mxcUrl;
		const httpUrl = mxcUrl && !mxcUrl.startsWith('blob:') ? getMediaUrl(mxcUrl) : null;
		let blob = null;
		if (mxcUrl?.startsWith('blob:')) {
			// local echo — fetch the object URL as a blob
			try { blob = await fetch(mxcUrl).then(r => r.blob()); } catch {}
		} else if (mxcUrl && httpUrl) {
			blob = await mediaCacheGet(mxcUrl, httpUrl);
		}

		if (blob) {
			const ext = blob.type.split('/')[1]?.split(';')[0] || 'jpg';
			const filename = (alt || 'image') + '.' + ext;
			const file = new File([blob], filename, { type: blob.type });
			// Web Share API: iOS opens native share sheet ("Save Image"), Android shows download
			if (navigator.canShare?.({ files: [file] })) {
				try { await navigator.share({ files: [file], title: alt || 'Image' }); } catch {}
				return; // don't fall through — cancel must not trigger <a download> on iOS
			}
			// Desktop fallback: blob URL so the browser downloads rather than navigating
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
			return;
		}

		// Last resort: direct URL (desktop, no blob available)
		const a = document.createElement('a');
		a.href = src;
		a.download = alt || 'image';
		a.click();
	}

	// Keyboard navigation
	function handleKeydown(e) {
		if (e.key === 'Escape') close();
		if (e.key === 'ArrowLeft') prev();
		if (e.key === 'ArrowRight') next();
	}

	// Touch swipe
	let touchStartX = 0;
	let touchStartY = 0;
	function onTouchStart(e) {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}
	function onTouchEnd(e) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		const dy = e.changedTouches[0].clientY - touchStartY;
		if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 60) { close(); return; }
		if (Math.abs(dx) > 60) { dx < 0 ? next() : prev(); }
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="lightbox" role="dialog" aria-label="Image viewer" tabindex="-1"
	on:click|self={close} on:keydown={handleKeydown}
	on:touchstart={onTouchStart} on:touchend={onTouchEnd}>

	<button class="lb-close" aria-label="Close" on:click={close}><X size={24} /></button>
	<button class="lb-save" aria-label="Save image" on:click={save}><Download size={22} /></button>

	{#if images.length > 1}
		<button class="lb-prev" aria-label="Previous" on:click={prev} disabled={current === 0}>
			<ChevronLeft size={28} />
		</button>
		<button class="lb-next" aria-label="Next" on:click={next} disabled={current === images.length - 1}>
			<ChevronRight size={28} />
		</button>
		<div class="lb-counter">{current + 1} / {images.length}</div>
	{/if}

	{#if src}
		<img {src} {alt} class="lb-image" />
	{/if}
</div>

<style>
	.lightbox {
		position: fixed; inset: 0; z-index: 300;
		background: rgba(0, 0, 0, 0.92);
		display: flex; align-items: center; justify-content: center;
		touch-action: pan-y;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}
	.lb-image {
		max-width: 95vw; max-height: 90vh;
		object-fit: contain;
		border-radius: var(--radius-sm);
		box-shadow: 0 8px 32px rgba(0,0,0,0.6);
		user-select: none;
		-webkit-user-drag: none;
	}
	.lb-close, .lb-save, .lb-prev, .lb-next {
		position: absolute;
		background: rgba(255,255,255,0.15); border: none; border-radius: 50%;
		width: 40px; height: 40px; cursor: pointer; color: #fff;
		display: flex; align-items: center; justify-content: center;
		backdrop-filter: blur(4px);
		transition: background 0.15s;
	}
	.lb-close:hover, .lb-save:hover, .lb-prev:hover, .lb-next:hover {
		background: rgba(255,255,255,0.28);
	}
	.lb-close { top: calc(16px + env(safe-area-inset-top)); right: calc(16px + env(safe-area-inset-right)); }
	.lb-save  { top: calc(16px + env(safe-area-inset-top)); right: calc(64px + env(safe-area-inset-right)); }
	.lb-prev  { left: calc(16px + env(safe-area-inset-left)); top: 50%; transform: translateY(-50%); }
	.lb-next  { right: calc(16px + env(safe-area-inset-right)); top: 50%; transform: translateY(-50%); }
	.lb-prev:disabled, .lb-next:disabled { opacity: 0.3; pointer-events: none; }
	.lb-counter {
		position: absolute; bottom: calc(20px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
		color: rgba(255,255,255,0.7); font-size: 0.875rem;
		background: rgba(0,0,0,0.4); padding: 2px 10px; border-radius: 12px;
	}
</style>
