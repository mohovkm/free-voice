<script>
	import { onDestroy, tick } from 'svelte';
	import { Play, Pause, AudioLines } from 'lucide-svelte';
	import { getMediaUrl } from '$lib/services/backends/matrix/client';
	import { get as mediaCacheGet } from '$lib/services/mediaCache';

	/** @type {import('../stores/matrixStore').MediaInfo} */
	export let media;

	let audioEl;
	let playing = false;
	let currentTime = 0;
	let totalDuration = 0;
	let blobUrl = null;
	let loading = false;
	let mediaExpired = false;
	let _ownedBlobUrl = null;

	$: if (media?.durationSecs && !totalDuration) totalDuration = media.durationSecs;
	function fmtTime(s) {
		const sec = Math.max(0, Math.floor(s));
		return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
	}

	async function loadAndToggle() {
		if (mediaExpired) return;
		if (blobUrl) { togglePlay(); return; }

		if (media?.mxcUrl?.startsWith('blob:')) {
			blobUrl = media.mxcUrl;
			await tick();
			togglePlay();
			return;
		}

		const httpUrl = media?.mxcUrl ? getMediaUrl(media.mxcUrl) : null;
		if (!httpUrl) return;

		loading = true;
		try {
			const blob = await mediaCacheGet(media.mxcUrl, httpUrl);
			if (!blob) { mediaExpired = true; return; }
			_ownedBlobUrl = URL.createObjectURL(blob);
			blobUrl = _ownedBlobUrl;
			await tick();
			togglePlay();
		} finally {
			loading = false;
		}
	}

	function togglePlay() {
		if (!audioEl) return;
		if (playing) audioEl.pause();
		else audioEl.play();
	}

	function onTimeUpdate() {
		currentTime = audioEl?.currentTime ?? 0;
	}

	function onLoadedMetadata() {
		if (audioEl?.duration && isFinite(audioEl.duration)) totalDuration = audioEl.duration;
	}

	function onEnded() {
		playing = false;
		currentTime = 0;
	}

	onDestroy(() => {
		if (_ownedBlobUrl) URL.revokeObjectURL(_ownedBlobUrl);
	});
</script>

{#if mediaExpired}
	<span class="expired-text">Audio expired</span>
{:else}
	<div class="audio-player">
		<button
			class="play-btn"
			aria-label={playing ? 'Pause' : 'Play'}
			on:click={loadAndToggle}
			disabled={loading}
		>
			{#if playing}<Pause size={16} />{:else}<Play size={16} />{/if}
		</button>

		<div class="middle">
			<div class="wave-row">
				<AudioLines size={28} class="wave-icon" />
				<AudioLines size={28} class="wave-icon" />
				<AudioLines size={28} class="wave-icon" />
				<AudioLines size={28} class="wave-icon" />
			</div>
		</div>

		<span class="time">
			{#if playing || currentTime > 0}
				{fmtTime(currentTime)} / {fmtTime(totalDuration)}
			{:else if totalDuration > 0}
				{fmtTime(totalDuration)}
			{:else}
				–:––
			{/if}
		</span>

		{#if blobUrl}
			<!-- svelte-ignore a11y-media-has-caption -->
			<audio
				bind:this={audioEl}
				src={blobUrl}
				on:play={() => (playing = true)}
				on:pause={() => (playing = false)}
				on:ended={onEnded}
				on:timeupdate={onTimeUpdate}
				on:loadedmetadata={onLoadedMetadata}
			></audio>
		{/if}
	</div>
{/if}

<style>
	.audio-player {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.play-btn {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.play-btn:hover { filter: brightness(1.1); }
	.play-btn:disabled { opacity: 0.5; cursor: default; }

	.middle {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.wave-row {
		display: flex;
		align-items: center;
		gap: 0;
	}

	:global(.wave-icon) {
		flex-shrink: 0;
		color: var(--accent);
		margin-right: -6px;
	}
	:global(.wave-icon:last-child) {
		margin-right: 0;
	}


	.time {
		flex-shrink: 0;
		font-size: 0.7rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.expired-text {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-style: italic;
	}
</style>
