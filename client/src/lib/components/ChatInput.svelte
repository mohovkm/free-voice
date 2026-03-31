<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import {
		Send,
		X,
		Paperclip,
		Mic,
		Video,
		ChevronRight,
		ChevronLeft,
		Pause,
		Play,
		Trash2,
		Square
	} from 'lucide-svelte';
	import { t } from '$lib/stores/i18n';
	import { MatrixMessageType } from '$lib/types/matrix';
	import {
		buildPendingAttachment,
		buildRecordedAudioFile,
		buildRecordedVideoFile,
		formatRecorderTime,
		revokePendingAttachment
	} from './chat-input-helpers';
	import type { PendingAttachment, ReplyTarget } from '$lib/types/routes';

	const dispatch = createEventDispatcher<{
		send: string;
		sendMedia: { file: File; messageType: PendingAttachment['messageType']; isRecording?: boolean };
		sendMediaGallery: { files: File[] };
		typing: boolean;
		cancelReply: void;
	}>();

	export let disabled = false;
	export let replyTo: ReplyTarget | null = null;

	let text = '';
	let mediaButtonsExpanded = true;
	let inputFocused = false;

	// --- pending attachments (preview before send) ---
	let pendingAttachments: PendingAttachment[] = [];

	// --- audio recording ---
	const audioSupported = typeof MediaRecorder !== 'undefined';
	let audioRecorder: MediaRecorder | null = null;
	let audioRecording = false;
	let audioPaused = false;
	let audioChunks: BlobPart[] = [];
	let audioSeconds = 0;
	let audioInterval: ReturnType<typeof setInterval> | null = null;
	let audioLimitReached = false;
	let audioBlob: Blob | null = null;
	const AUDIO_MAX = 120; // 2 minutes

	// --- video overlay ---
	const videoSupported = typeof MediaRecorder !== 'undefined';
	let showVideoOverlay = false;
	let videoStream: MediaStream | null = null;
	let videoRecorder: MediaRecorder | null = null;
	let videoRecording = false;
	let videoPaused = false;
	let videoChunks: BlobPart[] = [];
	let videoSeconds = 0;
	let videoInterval: ReturnType<typeof setInterval> | null = null;
	let facingMode: 'user' | 'environment' = 'user';
	let videoEl: HTMLVideoElement | undefined;
	const VIDEO_MAX = 120; // 2 minutes

	function stopInterval(timer: ReturnType<typeof setInterval> | null): null {
		if (timer !== null) clearInterval(timer);
		return null;
	}

	// ── Attachment picker ──────────────────────────────────────────────────────
	let fileInput: HTMLInputElement | undefined;

	function openFilePicker() {
		fileInput?.click();
	}

	async function handleFileChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		const files = Array.from(target.files || []);
		for (const file of files) {
			pendingAttachments = [...pendingAttachments, buildPendingAttachment(file)];
		}
		target.value = '';
	}

	function removeAttachment(i: number) {
		const a = pendingAttachments[i];
		revokePendingAttachment(a);
		pendingAttachments = pendingAttachments.filter((_, idx) => idx !== i);
	}

	// ── Audio recording ────────────────────────────────────────────────────────
	function _bestAudioMimeType() {
		// Prefer mp4/AAC: plays on iOS Safari, Chrome 123+, Edge, Firefox 130+.
		// Fall back to webm/opus for older Chrome/Firefox where mp4 recording is unsupported.
		for (const mimeType of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
			if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
		}
		return '';
	}

	async function startAudioRecord() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			audioChunks = [];
			audioSeconds = 0;
			audioLimitReached = false;
			const mimeType = _bestAudioMimeType();
			audioRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
			audioRecorder.ondataavailable = (e: BlobEvent) => {
				if (e.data && e.data.size > 0) audioChunks.push(e.data);
			};
			audioRecorder.onstop = () => {
				stream.getTracks().forEach((track) => track.stop());
				audioBlob = new Blob(audioChunks, { type: audioRecorder?.mimeType || 'audio/webm' });
				audioRecording = false;
				audioPaused = false;
				audioInterval = stopInterval(audioInterval);
			};
			audioRecorder.start(); // no timeslice — avoids fragmented MP4 chunks on iOS
			audioRecording = true;
			audioPaused = false;
			audioInterval = setInterval(() => {
				audioSeconds++;
				if (audioSeconds >= AUDIO_MAX) {
					audioLimitReached = true;
					audioRecorder?.stop();
				}
			}, 1000);
		} catch (err) {
			console.warn('Audio record failed:', err);
		}
	}

	function pauseAudio() {
		if (!audioRecorder) return;
		if (audioPaused) {
			audioRecorder.resume();
			audioInterval = setInterval(() => {
				audioSeconds++;
			}, 1000);
		} else {
			audioRecorder.pause();
			audioInterval = stopInterval(audioInterval);
		}
		audioPaused = !audioPaused;
	}

	function stopAudio() {
		audioRecorder?.stop();
	}

	function sendAudio() {
		if (!audioBlob) return;
		const file = buildRecordedAudioFile(audioBlob);
		// isRecording flag tells the room page to run extractAudioInfo for this send
		dispatch('sendMedia', { file, messageType: MatrixMessageType.AUDIO, isRecording: true });
		audioBlob = null;
		audioSeconds = 0;
	}

	function deleteAudio() {
		audioBlob = null;
		audioSeconds = 0;
		audioRecording = false;
	}

	// ── Video overlay ──────────────────────────────────────────────────────────
	async function openVideoOverlay() {
		showVideoOverlay = true;
		await startVideoStream();
	}

	async function startVideoStream() {
		videoStream?.getTracks().forEach((track) => track.stop());
		try {
			videoStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode },
				audio: true
			});
			if (videoEl) videoEl.srcObject = videoStream;
		} catch (err) {
			console.warn('Camera failed:', err);
			showVideoOverlay = false;
		}
	}

	async function swapCamera() {
		facingMode = facingMode === 'user' ? 'environment' : 'user';
		await startVideoStream();
	}

	function startVideoRecord() {
		if (!videoStream) return;
		videoChunks = [];
		videoSeconds = 0;
		videoRecorder = new MediaRecorder(videoStream);
		videoRecorder.ondataavailable = (e: BlobEvent) => {
			if (e.data && e.data.size > 0) videoChunks.push(e.data);
		};
		videoRecorder.onstop = async () => {
			videoInterval = stopInterval(videoInterval);
			videoRecording = false;
			videoPaused = false;
			const blob = new Blob(videoChunks, { type: videoRecorder?.mimeType || 'video/webm' });
			const file = buildRecordedVideoFile(blob);
			dispatch('sendMedia', { file, messageType: MatrixMessageType.VIDEO });
			closeVideoOverlay();
		};
		videoRecorder.start(); // no timeslice — produces one complete blob on stop(), avoids fragmented MP4 truncation
		videoRecording = true;
		videoPaused = false;
		videoInterval = setInterval(() => {
			videoSeconds++;
			if (videoSeconds >= VIDEO_MAX) videoRecorder?.stop();
		}, 1000);
	}

	function pauseVideo() {
		if (!videoRecorder) return;
		if (videoPaused) {
			videoRecorder.resume();
			videoInterval = setInterval(() => {
				videoSeconds++;
				if (videoSeconds >= VIDEO_MAX) videoRecorder?.stop();
			}, 1000);
		} else {
			videoRecorder.pause();
			videoInterval = stopInterval(videoInterval);
		}
		videoPaused = !videoPaused;
	}

	function stopAndSendVideo() {
		videoRecorder?.stop();
	}

	function deleteVideo() {
		videoRecorder?.stop();
		videoChunks = [];
		videoRecording = false;
		videoPaused = false;
		videoInterval = stopInterval(videoInterval);
		videoSeconds = 0;
		closeVideoOverlay();
	}

	function closeVideoOverlay() {
		videoInterval = stopInterval(videoInterval);
		videoStream?.getTracks().forEach((track) => track.stop());
		videoStream = null;
		videoRecording = false;
		videoPaused = false;
		videoSeconds = 0;
		showVideoOverlay = false;
	}

	// ── Text submit ────────────────────────────────────────────────────────────
	function handleSubmit() {
		// Group images together as a gallery; send other types individually
		const images = pendingAttachments.filter((a) => a.messageType === MatrixMessageType.IMAGE);
		const others = pendingAttachments.filter((a) => a.messageType !== MatrixMessageType.IMAGE);

		if (images.length > 0) {
			dispatch('sendMediaGallery', { files: images.map((a) => a.file) });
			images.forEach(revokePendingAttachment);
		}
		for (const a of others) {
			dispatch('sendMedia', { file: a.file, messageType: a.messageType });
			revokePendingAttachment(a);
		}
		pendingAttachments = [];

		const body = text.trim();
		if (body) {
			dispatch('send', body);
			dispatch('typing', false);
			text = '';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleInput() {
		dispatch('typing', text.length > 0);
	}
	function handleInputFocus() {
		inputFocused = true;
		mediaButtonsExpanded = false;
	}
	function handleInputBlur() {
		inputFocused = false;
		mediaButtonsExpanded = true;
	}

	function cancelReply() {
		dispatch('cancelReply');
	}

	onDestroy(() => {
		audioInterval = stopInterval(audioInterval);
		videoInterval = stopInterval(videoInterval);
		videoStream?.getTracks().forEach((track) => track.stop());
		pendingAttachments.forEach(revokePendingAttachment);
	});
</script>

<!-- Video overlay (full-screen) -->
{#if showVideoOverlay}
	<div class="video-overlay" role="dialog" aria-label="Video recording">
		<video bind:this={videoEl} autoplay muted playsinline class="overlay-preview"></video>

		{#if videoRecording}
			<div class="overlay-timer" class:paused={videoPaused}>
				{formatRecorderTime(videoSeconds)} / {formatRecorderTime(VIDEO_MAX)}
			</div>
			<div class="overlay-progress">
				<div class="overlay-progress-bar" style="width:{(videoSeconds / VIDEO_MAX) * 100}%"></div>
			</div>
		{/if}

		<div class="overlay-controls">
			{#if !videoRecording}
				<button class="ov-btn" aria-label="Swap camera" on:click={swapCamera}>⇄</button>
				<button class="ov-btn ov-record" aria-label="Start recording" on:click={startVideoRecord}
					>●</button
				>
				<button class="ov-btn ov-close" aria-label="Close" on:click={closeVideoOverlay}
					><X size={20} /></button
				>
			{:else}
				<button class="ov-btn ov-delete" aria-label="Delete" on:click={deleteVideo}
					><Trash2 size={20} /></button
				>
				<button
					class="ov-btn ov-pause"
					aria-label={videoPaused ? 'Resume' : 'Pause'}
					on:click={pauseVideo}
				>
					{#if videoPaused}<Play size={20} />{:else}<Pause size={20} />{/if}
				</button>
				<button class="ov-btn ov-send" aria-label="Send" on:click={stopAndSendVideo}
					><Send size={20} /></button
				>
			{/if}
		</div>
	</div>
{/if}

<!-- Reply preview -->
{#if replyTo}
	<div class="reply-preview">
		<div class="reply-preview-content">
			{#if replyTo.senderName}<span class="reply-preview-sender">{replyTo.senderName}</span>{/if}
			<span class="reply-preview-body">{replyTo.body}</span>
		</div>
		<button class="btn-icon cancel-reply-btn" aria-label="Cancel reply" on:click={cancelReply}>
			<X size={16} />
		</button>
	</div>
{/if}

<!-- Pending attachments preview -->
{#if pendingAttachments.length > 0}
	<div class="attachments-preview">
		{#each pendingAttachments as a, i (a.file.name + i)}
			<div class="attachment-chip">
				{#if a.previewUrl && a.messageType === MatrixMessageType.IMAGE}
					<img src={a.previewUrl} alt={a.file.name} class="chip-thumb" />
				{:else}
					<span class="chip-icon">📎</span>
				{/if}
				<span class="chip-name">{a.file.name}</span>
				<button class="chip-remove" aria-label="Remove" on:click={() => removeAttachment(i)}
					><X size={12} /></button
				>
			</div>
		{/each}
	</div>
{/if}

<!-- Audio recording UI -->
{#if audioRecording || audioBlob}
	{#if audioLimitReached}
		<div class="audio-limit-notice">Maximum recording length reached (2 min)</div>
	{/if}
	<div class="audio-recorder">
		<div class="audio-waveform">
			<span class="audio-dot" class:pulse={audioRecording && !audioPaused}></span>
			<div class="audio-progress-track">
				<div
					class="audio-progress-fill"
					style="width:{Math.min(audioSeconds / AUDIO_MAX, 1) * 100}%"
				></div>
			</div>
			<span class="audio-time">{formatRecorderTime(audioSeconds)}</span>
		</div>
		<div class="audio-actions">
			<button class="btn-icon audio-delete" aria-label="Delete" on:click={deleteAudio}
				><Trash2 size={18} /></button
			>
			{#if audioRecording}
				<button
					class="btn-icon audio-pause"
					aria-label={audioPaused ? 'Resume' : 'Pause'}
					on:click={pauseAudio}
				>
					{#if audioPaused}<Play size={18} />{:else}<Pause size={18} />{/if}
				</button>
				<button class="btn-icon audio-stop" aria-label="Stop" on:click={stopAudio}
					><Square size={18} /></button
				>
			{:else}
				<button class="btn-icon audio-send" aria-label="Send" on:click={sendAudio}
					><Send size={18} /></button
				>
			{/if}
		</div>
	</div>
{/if}

<!-- Main input bar -->
<form
	class="chat-input"
	class:safe-bottom={!inputFocused}
	on:submit|preventDefault={handleSubmit}
	aria-label="Send message"
>
	<input
		bind:this={fileInput}
		type="file"
		class="hidden-file-input"
		accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt,.zip"
		multiple
		on:change={handleFileChange}
	/>

	{#if !mediaButtonsExpanded}
		<button
			type="button"
			class="btn-icon expand-btn"
			aria-label="Show media buttons"
			on:click={() => (mediaButtonsExpanded = true)}
		>
			<ChevronRight size={20} />
		</button>
	{:else}
		<button
			type="button"
			class="btn-icon collapse-btn"
			aria-label="Hide media buttons"
			on:click={() => (mediaButtonsExpanded = false)}
		>
			<ChevronLeft size={20} />
		</button>
		<button
			type="button"
			class="btn-icon attach-btn"
			aria-label="Attach file"
			on:click={openFilePicker}
			{disabled}><Paperclip size={20} /></button
		>
		{#if audioSupported}
			<button
				type="button"
				class="btn-icon mic-btn"
				aria-label="Record audio"
				on:click={startAudioRecord}
				disabled={disabled || audioRecording || Boolean(audioBlob)}
			>
				<Mic size={20} />
			</button>
		{/if}
		{#if videoSupported}
			<button
				type="button"
				class="btn-icon video-btn"
				aria-label="Record video"
				on:click={openVideoOverlay}
				{disabled}><Video size={20} /></button
			>
		{/if}
	{/if}

	<input
		type="text"
		bind:value={text}
		placeholder={$t('messagePlaceholder')}
		autocomplete="off"
		enterkeyhint="send"
		aria-label={$t('messagePlaceholder')}
		on:keydown={handleKeydown}
		on:input={handleInput}
		on:focus={handleInputFocus}
		on:blur={handleInputBlur}
		{disabled}
	/>

	<button
		type="submit"
		class="btn-icon send-btn"
		aria-label={$t('send')}
		disabled={disabled || (!text.trim() && pendingAttachments.length === 0 && !audioBlob)}
	>
		<Send size={20} />
	</button>
</form>

<style>
	.hidden-file-input {
		display: none;
	}

	/* Reply preview */
	.reply-preview {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
		border-left: 3px solid var(--accent, #2196f3);
	}
	.reply-preview-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.reply-preview-sender {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent, #2196f3);
	}
	.reply-preview-body {
		font-size: 0.8125rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cancel-reply-btn {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	/* Attachments preview */
	.attachments-preview {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 6px 12px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
	}
	.attachment-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		padding: 4px 6px;
		max-width: 140px;
	}
	.chip-thumb {
		width: 32px;
		height: 32px;
		object-fit: cover;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.chip-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	.chip-name {
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.chip-remove {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-muted);
		padding: 0;
		flex-shrink: 0;
	}

	/* Audio recorder */
	.audio-limit-notice {
		padding: 4px 12px;
		font-size: 0.75rem;
		color: var(--danger);
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
	}
	.audio-recorder {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
	}
	.audio-waveform {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
	}
	.audio-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--danger);
		flex-shrink: 0;
	}
	.audio-dot.pulse {
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.8);
		}
	}
	.audio-progress-track {
		flex: 1;
		height: 4px;
		background: var(--border);
		border-radius: 2px;
		overflow: hidden;
	}
	.audio-progress-fill {
		height: 100%;
		background: var(--danger);
		transition: width 0.5s linear;
	}
	.audio-time {
		font-size: 0.75rem;
		color: var(--text-muted);
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.audio-actions {
		display: flex;
		gap: 4px;
	}
	.audio-delete {
		color: var(--text-muted);
	}
	.audio-pause {
		color: var(--accent);
	}
	.audio-stop {
		color: var(--danger);
	}
	.audio-send {
		color: var(--accent);
	}

	/* Main input */
	.chat-input {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 8px 12px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
		flex-shrink: 0;
	}
	.chat-input.safe-bottom {
		padding-bottom: calc(8px + env(safe-area-inset-bottom));
	}
	.chat-input input[type='text'] {
		flex: 1;
		margin-bottom: 0;
	}
	.send-btn {
		color: var(--accent);
	}
	.send-btn:disabled {
		opacity: 0.4;
	}
	.attach-btn,
	.mic-btn,
	.video-btn,
	.expand-btn,
	.collapse-btn,
	.send-btn {
		width: 32px;
		height: 32px;
		color: var(--text-muted);
		flex-shrink: 0;
	}
	.expand-btn {
		color: var(--accent);
	}

	/* Video overlay */
	.video-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: #000;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}
	.overlay-preview {
		width: 100%;
		max-height: calc(100% - 120px);
		object-fit: cover;
	}
	.overlay-timer {
		position: absolute;
		top: 16px;
		right: 16px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 0.875rem;
		padding: 4px 10px;
		border-radius: 20px;
		font-variant-numeric: tabular-nums;
	}
	.overlay-timer.paused {
		opacity: 0.5;
	}
	.overlay-progress {
		position: absolute;
		bottom: 100px;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(255, 255, 255, 0.2);
	}
	.overlay-progress-bar {
		height: 100%;
		background: var(--danger);
		transition: width 0.5s linear;
	}
	.overlay-controls {
		position: absolute;
		bottom: 24px;
		display: flex;
		gap: 24px;
		align-items: center;
	}
	.ov-btn {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		color: #fff;
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(4px);
		transition: background 0.15s;
	}
	.ov-btn:hover {
		background: rgba(255, 255, 255, 0.25);
	}
	.ov-record {
		background: var(--danger);
		width: 64px;
		height: 64px;
		font-size: 1.5rem;
	}
	.ov-record:hover {
		background: #c73650;
	}
	.ov-send {
		background: var(--accent);
	}
	.ov-send:hover {
		background: var(--accent-hover);
	}
	.ov-delete {
		background: rgba(255, 255, 255, 0.1);
	}
	.ov-pause {
		background: rgba(255, 255, 255, 0.1);
	}
	.ov-close {
		background: rgba(255, 255, 255, 0.1);
	}
</style>
