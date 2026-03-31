<script lang="ts">
	import { ArrowLeft, Phone, Settings, Trash2, Video } from 'lucide-svelte';
	import Avatar from './Avatar.svelte';
	import type { ChatHeaderContract } from '$lib/types/routes';

	export let name: ChatHeaderContract['name'] = '';
	export let online: ChatHeaderContract['online'] = false;
	export let backHref: ChatHeaderContract['backHref'] = '/';
	export let onCall: ChatHeaderContract['onCall'] = null;
	export let onVideoCall: ChatHeaderContract['onVideoCall'] = null;
	export let onSettings: ChatHeaderContract['onSettings'] = null;
	export let onLeave: ChatHeaderContract['onLeave'] = null;
</script>

<header class="chat-header">
	<a href={backHref || '/'} class="btn-icon" aria-label="Back">
		<ArrowLeft size={20} />
	</a>
	<Avatar {name} size={36} />
	<div class="header-info">
		<span class="header-name">{name}</span>
		{#if online}
			<span class="header-status text-sm">online</span>
		{/if}
	</div>
	<div class="header-actions">
		{#if onCall}
			<button class="btn-icon" on:click={onCall} aria-label="Audio call">
				<Phone size={20} />
			</button>
		{/if}
		{#if onVideoCall}
			<button class="btn-icon" on:click={onVideoCall} aria-label="Video call">
				<Video size={20} />
			</button>
		{/if}
		{#if onSettings}
			<button class="btn-icon" on:click={onSettings} aria-label="Chat settings">
				<Settings size={20} />
			</button>
		{/if}
		{#if onLeave}
			<button class="btn-icon btn-leave" on:click={onLeave} aria-label="Leave chat">
				<Trash2 size={20} />
			</button>
		{/if}
	</div>
</header>

<style>
	.chat-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
		min-height: 56px;
	}
	.header-info {
		flex: 1;
		min-width: 0;
	}
	.header-name {
		font-weight: 600;
		font-size: 0.9375rem;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.header-status {
		color: var(--success);
	}
	.header-actions {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}
	.btn-leave {
		color: var(--danger);
	}
</style>
