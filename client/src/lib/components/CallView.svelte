<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import CallControls from './CallControls.svelte';
	import { t } from '$lib/stores/i18n';
	import { CallEndReason } from '$lib/stores/call';
	import { CallPhase } from '$lib/types/call';
	import type { CallViewContract } from '$lib/types/routes';

	export let phase: CallViewContract['phase'] = CallPhase.IDLE;
	export let endReason: CallViewContract['endReason'] = null;
	export let remoteName: CallViewContract['remoteName'] = '';
	export let micMuted: CallViewContract['micMuted'] = false;
	export let camOff: CallViewContract['camOff'] = false;
	export let video: CallViewContract['video'] = true;
	export let participantCount: CallViewContract['participantCount'] = 0;
	export let participantLabel: CallViewContract['participantLabel'] = '';
	export let waitingForOthers: CallViewContract['waitingForOthers'] = false;

	const dispatch = createEventDispatcher<{ mount: void }>();

	let remoteAudio: HTMLAudioElement | undefined;
	let remoteVideo: HTMLVideoElement | undefined;
	let localVideo: HTMLVideoElement | undefined;

	onMount(() => dispatch('mount'));

	export function getMediaElements() {
		return { remoteAudio, remoteVideo, localVideo };
	}

	const END_REASON_KEYS: Record<string, string> = {
		[CallEndReason.HANGUP]: 'callEndedHangup',
		[CallEndReason.REMOTE_HANGUP]: 'callEndedHangup',
		[CallEndReason.DECLINED]: 'callEndedDeclined',
		[CallEndReason.BUSY]: 'callEndedBusy',
		[CallEndReason.NO_ANSWER]: 'callEndedNoAnswer',
		[CallEndReason.CANCELLED]: 'callEndedCancelled',
		[CallEndReason.ANSWERED_ELSEWHERE]: 'callEndedAnsweredElsewhere',
		[CallEndReason.NETWORK_ERROR]: 'callEndedNetworkError',
		[CallEndReason.ERROR]: 'callEndedError'
	};

	$: overlayText = (() => {
		switch (phase) {
			case CallPhase.ACQUIRING_MEDIA:
				return $t('callAcquiringMedia');
			case CallPhase.REGISTERING:
				return $t('callConnecting');
			case CallPhase.RINGING_OUT:
				return remoteName ? `${$t('callRinging')} ${remoteName}...` : $t('callRinging') + '...';
			case CallPhase.CONNECTING:
				return $t('callConnecting');
			case CallPhase.ENDED:
				return endReason
					? $t(END_REASON_KEYS[endReason] || 'callEndedHangup')
					: $t('callEndedHangup');
			default:
				return null;
		}
	})();

	$: showOverlay = phase !== CallPhase.CONNECTED && phase !== CallPhase.RECONNECTING;
	$: controlsDisabled = phase !== CallPhase.CONNECTED;
</script>

<div class="call-view">
	<audio bind:this={remoteAudio} autoplay></audio>
	<video bind:this={remoteVideo} class="remote-video" autoplay playsinline></video>
	{#if video}
		<video bind:this={localVideo} class="local-video" autoplay playsinline muted></video>
	{/if}

	{#if remoteName && phase === CallPhase.CONNECTED}
		<div class="remote-name">{remoteName}</div>
	{/if}

	{#if phase === CallPhase.CONNECTED && participantCount > 0}
		<div class="participant-pill">{participantCount} {$t('participants')}</div>
	{/if}

	{#if phase === CallPhase.CONNECTED && waitingForOthers}
		<div class="waiting-banner">{$t('callInProgress')}</div>
	{:else if phase === CallPhase.CONNECTED && participantLabel}
		<div class="waiting-banner">{participantLabel}</div>
	{/if}

	{#if phase === CallPhase.RECONNECTING}
		<div class="reconnect-banner">{$t('callReconnecting')}</div>
	{/if}

	{#if showOverlay}
		<div class="call-overlay" class:ended={phase === CallPhase.ENDED}>
			{#if phase === CallPhase.RINGING_OUT}
				<span class="pulse">{overlayText}</span>
			{:else}
				{overlayText}
			{/if}
		</div>
	{/if}

	<div class="controls-wrap">
		<CallControls
			{micMuted}
			{camOff}
			{video}
			disabled={controlsDisabled}
			on:toggleMic
			on:toggleCam
			on:hangup
		/>
	</div>
</div>

<style>
	.call-view {
		position: relative;
		flex: 1;
		background: #000;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		height: 100%;
	}
	.remote-video {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.local-video {
		position: absolute;
		top: 16px;
		right: 16px;
		width: 120px;
		border-radius: var(--radius-md);
		z-index: 2;
		transform: scaleX(-1);
	}
	.remote-name {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		color: #fff;
		font-size: 0.9375rem;
		font-weight: 500;
		background: rgba(0, 0, 0, 0.45);
		padding: 4px 12px;
		border-radius: 20px;
		z-index: 2;
	}
	.participant-pill {
		position: absolute;
		top: 16px;
		right: 16px;
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		background: rgba(0, 0, 0, 0.45);
		padding: 4px 10px;
		border-radius: 20px;
		z-index: 2;
	}
	.waiting-banner {
		position: absolute;
		top: 56px;
		left: 50%;
		transform: translateX(-50%);
		color: #fff;
		font-size: 0.875rem;
		background: rgba(0, 0, 0, 0.45);
		padding: 4px 12px;
		border-radius: 20px;
		z-index: 2;
	}
	.reconnect-banner {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		background: rgba(255, 160, 0, 0.9);
		color: #000;
		text-align: center;
		padding: 8px;
		font-size: 0.875rem;
		font-weight: 500;
		z-index: 4;
	}
	.call-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--overlay);
		color: #fff;
		font-size: 1.125rem;
		z-index: 1;
	}
	.call-overlay.ended {
		font-size: 1.25rem;
		font-weight: 600;
	}
	.pulse {
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
	.controls-wrap {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 3;
		display: flex;
		justify-content: center;
		padding: 24px 0 calc(24px + env(safe-area-inset-bottom));
	}
</style>
