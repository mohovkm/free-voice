<script>
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { callStore } from '$lib/stores/call';
	import {
		joinRoom,
		hangup,
		toggleMic,
		toggleCam,
		setMediaElements
	} from '$lib/services/callSession';
	import CallView from '$lib/components/CallView.svelte';

	$: roomId = $page.params.id;
	let callView;

	onMount(() => joinRoom(roomId));
	onDestroy(() => hangup());

	function onMediaReady() {
		const els = callView?.getMediaElements();
		if (els) setMediaElements(els.remoteAudio, els.remoteVideo, els.localVideo);
	}
</script>

<div class="call-page">
	<CallView
		bind:this={callView}
		on:mount={onMediaReady}
		phase={$callStore.phase}
		endReason={$callStore.endReason}
		remoteName={$callStore.remoteName}
		micMuted={$callStore.micMuted}
		camOff={$callStore.camOff}
		video={$callStore.video}
		participantCount={$callStore.participantCount}
		participantLabel={$callStore.participantLabel}
		waitingForOthers={$callStore.waitingForOthers}
		on:toggleMic={toggleMic}
		on:toggleCam={toggleCam}
		on:hangup={hangup}
	/>
</div>

<style>
	.call-page {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
</style>
