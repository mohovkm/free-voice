<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { CornerUpLeft } from 'lucide-svelte';
	import FileAttachment from './FileAttachment.svelte';
	import AudioPlayer from './AudioPlayer.svelte';
	import MediaThumbnail from './MediaThumbnail.svelte';
	import SystemMessage from './SystemMessage.svelte';
	import CallMessage from './CallMessage.svelte';
	import type { ChatBubbleContract } from '$lib/types/routes';
	import { MatrixTimelineType, type MatrixMediaPayload } from '$lib/types/matrix';

	export let body: ChatBubbleContract['body'] = '';
	export let type: ChatBubbleContract['type'] = MatrixTimelineType.TEXT;
	export let callMeta: ChatBubbleContract['callMeta'] = null;
	export let media: ChatBubbleContract['media'] = null;
	export let mine: ChatBubbleContract['mine'] = false;
	export let time: ChatBubbleContract['time'] = '';
	export let senderName: ChatBubbleContract['senderName'] = '';
	export let read: ChatBubbleContract['read'] = false;
	export let replyTo: ChatBubbleContract['replyTo'] = null;
	export let eventId: ChatBubbleContract['eventId'] = '';
	export let isGroup: ChatBubbleContract['isGroup'] = false;

	const dispatch = createEventDispatcher<{
		reply: { id: string; body: string; senderName: string };
		lightbox: { src: string; alt: string };
		videoopen: { media: MatrixMediaPayload };
	}>();

	function handleReply() {
		dispatch('reply', { id: eventId, body, senderName });
	}
</script>

{#if type === MatrixTimelineType.SYSTEM}
	<SystemMessage {body} />
{:else if type === MatrixTimelineType.CALL}
	<CallMessage {callMeta} />
{:else}
	<div class="bubble" class:mine aria-label="{mine ? 'You' : 'Them'}: {body}">
		{#if isGroup && !mine && senderName}
			<div class="sender">{senderName}</div>
		{/if}
		{#if replyTo}
			<div class="reply-quote">
				{#if replyTo.senderName}<span class="reply-sender">{replyTo.senderName}</span>{/if}
				<span class="reply-body">{replyTo.body}</span>
			</div>
		{/if}
		{#if type === MatrixTimelineType.IMAGE && media}
			<MediaThumbnail
				type="image"
				{media}
				alt={body}
				on:open={() => dispatch('lightbox', { src: media.mxcUrl || '', alt: body })}
			/>
		{:else if type === MatrixTimelineType.AUDIO && media}
			<div class="audio-wrap"><AudioPlayer {media} /></div>
		{:else if type === MatrixTimelineType.VIDEO && media}
			<MediaThumbnail
				type="video"
				{media}
				alt={body}
				on:open={() => dispatch('videoopen', { media })}
			/>
		{:else if type === MatrixTimelineType.FILE && media}
			<FileAttachment {media} />
		{:else}
			<p>{body}</p>
		{/if}
		{#if time || (mine && read !== undefined)}
			<span class="ts">
				{#if time}{time}{/if}{#if mine}<span class="tick" class:read>{read ? '✓✓' : '✓'}</span>{/if}
			</span>
		{/if}
		<button class="reply-btn" class:mine aria-label="Reply" on:click={handleReply}
			><CornerUpLeft size={14} /></button
		>
	</div>
{/if}

<style>
	.bubble {
		max-width: 75%;
		padding: 8px 12px;
		border-radius: var(--radius-md);
		background: var(--bubble-recv);
		align-self: flex-start;
		word-wrap: break-word;
		position: relative;
		border: 1px solid var(--bubble-border, transparent);
	}
	.bubble.mine {
		background: var(--bubble-sent);
		align-self: flex-end;
	}
	.sender {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-muted);
		margin-bottom: 4px;
	}
	.reply-quote {
		border-left: 3px solid var(--accent, #2196f3);
		padding: 4px 8px;
		margin-bottom: 6px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.06);
		font-size: 0.8125rem;
		line-height: 1.3;
		overflow: hidden;
		max-height: 3.6em;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.reply-sender {
		font-weight: 600;
		color: var(--accent, #2196f3);
		font-size: 0.75rem;
	}
	.reply-body {
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	p {
		font-size: 0.9375rem;
		line-height: 1.4;
		margin: 0;
	}
	.ts {
		display: block;
		font-size: 0.6875rem;
		color: var(--text-muted);
		text-align: right;
		margin-top: 1px;
	}
	.tick {
		margin-left: 2px;
		font-size: 0.625rem;
		opacity: 0.5;
	}
	.tick.read {
		opacity: 1;
		color: var(--accent, #2196f3);
	}
	.reply-btn {
		position: absolute;
		top: 4px;
		right: -28px;
		background: none;
		border: none;
		padding: 2px 4px;
		font-size: 0.875rem;
		cursor: pointer;
		color: var(--text-muted);
		opacity: 0.6;
		transition: opacity 0.15s;
		line-height: 1;
	}
	.audio-wrap {
		width: 100%;
		min-width: 0;
	}
	/* For sent (mine) bubbles the button sits on the left side */
	.reply-btn.mine {
		right: auto;
		left: -28px;
	}
	.bubble:hover .reply-btn,
	.bubble:focus-within .reply-btn {
		opacity: 1;
	}
</style>
