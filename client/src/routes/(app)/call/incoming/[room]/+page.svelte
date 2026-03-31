<script>
	import { page } from '$app/stores';
	import { onDestroy, onMount, tick } from 'svelte';
	import { callStore } from '$lib/stores/call';
	import {
		answer,
		decline,
		hangup,
		toggleMic,
		toggleCam,
		setMediaElements
	} from '$lib/services/callSession';
	import { _update } from '$lib/stores/call';
	import { CallMode, CallPhase } from '$lib/types/call';
	import CallView from '$lib/components/CallView.svelte';

	$: room = $page.params.room;
	$: callerName = $callStore.remoteName || $page.url.searchParams.get('name') || 'Unknown';
	$: videoEnabled = $callStore.video ?? $page.url.searchParams.get('video') !== '0';
	$: isRinging = $callStore.phase === CallPhase.RINGING_IN;

	let callView;

	onMount(async () => {
		if ($callStore.phase === CallPhase.IDLE || $callStore.phase === CallPhase.ENDED) {
			_update({
				phase: CallPhase.RINGING_IN,
				roomName: room,
				remoteName: callerName,
				video: videoEnabled,
				mode: CallMode.P2P
			});
		}
		// Ensure callView is bound before wiring media elements
		await tick();
		const els = callView?.getMediaElements();
		if (els) setMediaElements(els.remoteAudio, els.remoteVideo, els.localVideo);
	});

	function onMediaReady() {
		// Wire up media elements as soon as CallView mounts so answer() always has live elements.
		const els = callView?.getMediaElements();
		if (els) setMediaElements(els.remoteAudio, els.remoteVideo, els.localVideo);
	}

	onDestroy(() => {
		if ($callStore.phase === CallPhase.RINGING_IN) decline(room);
	});
</script>

<!-- CallView always mounted so media elements exist before answer() -->
<div class="call-page" class:hidden={isRinging}>
	<CallView
		bind:this={callView}
		on:mount={onMediaReady}
		phase={$callStore.phase}
		endReason={$callStore.endReason}
		remoteName={callerName}
		micMuted={$callStore.micMuted}
		camOff={$callStore.camOff}
		video={videoEnabled}
		on:toggleMic={toggleMic}
		on:toggleCam={toggleCam}
		on:hangup={hangup}
	/>
</div>

{#if isRinging}
	<div class="incoming-screen">
		<div class="caller-info">
			<div class="avatar">{videoEnabled ? '📹' : '📞'}</div>
			<p class="caller-name">{callerName}</p>
			<p class="label">{videoEnabled ? 'Incoming video call' : 'Incoming audio call'}</p>
		</div>
		<div class="incoming-actions">
			<button class="btn-decline" on:click={() => decline(room)} aria-label="Decline call">✕</button
			>
			<button
				class="btn-answer"
				on:click={() => answer(room, videoEnabled)}
				aria-label="Answer call">✓</button
			>
		</div>
	</div>
{/if}

<style>
	.call-page {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.call-page.hidden {
		opacity: 0;
		pointer-events: none;
	}
	.incoming-screen {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 32px;
		background: #0a0a0a;
		color: #fff;
		z-index: 10;
	}
	.caller-info {
		text-align: center;
	}
	.avatar {
		font-size: 64px;
	}
	.caller-name {
		font-size: 24px;
		font-weight: 600;
		margin: 8px 0 4px;
	}
	.label {
		color: #aaa;
		font-size: 14px;
		margin: 0;
	}
	.incoming-actions {
		display: flex;
		gap: 48px;
	}
	.btn-decline,
	.btn-answer {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: none;
		font-size: 24px;
		cursor: pointer;
	}
	.btn-decline {
		background: #e53935;
		color: #fff;
	}
	.btn-answer {
		background: #43a047;
		color: #fff;
	}
</style>
