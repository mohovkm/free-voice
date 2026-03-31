<script>
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { callStore } from '$lib/stores/call';
	import {
		dial,
		cancel,
		hangup,
		toggleMic,
		toggleCam,
		setMediaElements
	} from '$lib/services/callSession';
	import CallView from '$lib/components/CallView.svelte';

	$: email = decodeURIComponent($page.params.email);
	$: videoEnabled = $page.url.searchParams.get('video') !== '0';
	let callView;

	onMount(async () => {
		await tick();
		const els = callView?.getMediaElements();
		if (els) setMediaElements(els.remoteAudio, els.remoteVideo, els.localVideo);
		dial(email, videoEnabled);
	});
</script>

<div class="call-page">
	<CallView
		bind:this={callView}
		phase={$callStore.phase}
		endReason={$callStore.endReason}
		remoteName={$callStore.remoteName}
		micMuted={$callStore.micMuted}
		camOff={$callStore.camOff}
		video={$callStore.video}
		on:toggleMic={toggleMic}
		on:toggleCam={toggleCam}
		on:hangup={hangup}
	/>
</div>

<style>
	.call-page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		overflow: hidden;
	}
</style>
