<script lang="ts">
	import { Mic, MicOff, Camera, CameraOff, PhoneOff } from 'lucide-svelte';
	import { createEventDispatcher } from 'svelte';

	export let micMuted = false;
	export let camOff = false;
	export let video = true;
	export let disabled = false;

	const dispatch = createEventDispatcher<{
		toggleMic: void;
		toggleCam: void;
		hangup: void;
	}>();
</script>

<div class="call-controls">
	<button
		class="ctrl-btn"
		class:active={micMuted}
		on:click={() => dispatch('toggleMic')}
		aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
		{disabled}
	>
		{#if micMuted}<MicOff size={24} />{:else}<Mic size={24} />{/if}
	</button>
	{#if video}
		<button
			class="ctrl-btn"
			class:active={camOff}
			on:click={() => dispatch('toggleCam')}
			aria-label={camOff ? 'Turn on camera' : 'Turn off camera'}
			{disabled}
		>
			{#if camOff}<CameraOff size={24} />{:else}<Camera size={24} />{/if}
		</button>
	{/if}
	<button class="ctrl-btn hangup" on:click={() => dispatch('hangup')} aria-label="End call">
		<PhoneOff size={24} />
	</button>
</div>

<style>
	.call-controls {
		display: flex;
		gap: 20px;
		justify-content: center;
		align-items: center;
		padding: 16px 28px;
		background: rgba(0, 0, 0, 0.65);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border-radius: 40px;
	}
	.ctrl-btn {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
		cursor: pointer;
		transition:
			transform 0.15s,
			background 0.15s;
	}
	.ctrl-btn:hover {
		transform: scale(1.08);
		background: rgba(255, 255, 255, 0.28);
	}
	.ctrl-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		transform: none;
	}
	/* Muted/off state — red pill like FaceTime */
	.ctrl-btn.active {
		background: rgba(255, 59, 48, 0.85);
	}
	.ctrl-btn.active:hover {
		background: rgba(255, 59, 48, 1);
	}
	/* Hang up — wider pill, solid red */
	.hangup {
		width: 72px;
		border-radius: 28px;
		background: #ff3b30;
	}
	.hangup:hover {
		background: #e0352b;
		transform: scale(1.08);
	}
</style>
