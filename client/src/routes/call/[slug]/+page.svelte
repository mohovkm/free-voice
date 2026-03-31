<script lang="ts">
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import { callStore, isInCall } from '$lib/stores/call';
	import {
		joinAsGuest,
		hangup,
		toggleMic,
		toggleCam,
		setMediaElements
	} from '$lib/services/callSession';
	import CallView from '$lib/components/CallView.svelte';
	import { CallPhase } from '$lib/types/call';

	interface CallViewBindings {
		getMediaElements: () => {
			remoteAudio?: HTMLAudioElement;
			remoteVideo?: HTMLVideoElement;
			localVideo?: HTMLVideoElement;
		};
	}

	let slug = '';
	$: slug = $page.params.slug ?? '';
	let guestName = '';
	let error = '';
	let callView: CallViewBindings | undefined;

	onDestroy(() => hangup());

	async function handleJoin() {
		if (!guestName.trim()) return;
		error = '';
		try {
			await joinAsGuest(slug, guestName.trim());
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function onMediaReady() {
		const els = callView?.getMediaElements();
		if (els) setMediaElements(els.remoteAudio ?? null, els.remoteVideo ?? null, els.localVideo ?? null);
	}
</script>

{#if !$isInCall && $callStore.phase === CallPhase.IDLE}
	<div class="guest-shell">
		<div class="card guest-card">
			<div class="guest-brand">
				<img src="/logo.png" alt="" class="guest-logo" />
				<h1>FREE VOICE</h1>
			</div>
			<p class="text-secondary text-sm">Join a call</p>
			<form on:submit|preventDefault={handleJoin}>
				<input type="text" bind:value={guestName} placeholder="Your name" required />
				<button type="submit" class="btn-primary">Join Call</button>
			</form>
			{#if error}<p class="error-msg">{error}</p>{/if}
		</div>
	</div>
{:else}
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
			on:toggleMic={toggleMic}
			on:toggleCam={toggleCam}
			on:hangup={hangup}
		/>
	</div>
{/if}

<style>
	.guest-shell {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 16px;
		background: var(--bg-primary);
	}
	.guest-card {
		width: 360px;
		max-width: 90vw;
	}
	.guest-brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
	}
	.guest-logo {
		height: 36px;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 20px;
	}
	.error-msg {
		color: var(--danger);
		text-align: center;
		margin-top: 10px;
		font-size: 0.8125rem;
	}
	.call-page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
</style>
