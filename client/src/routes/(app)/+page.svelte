<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Plus, MessageSquarePlus, Users } from 'lucide-svelte';
	import { t } from '$lib/stores/i18n';
	import { unreadCounts } from '$lib/stores/unread';
	import ConversationItem from '$lib/components/ConversationItem.svelte';
	import { backend } from '$lib/services/activeBackend';
	import { presenceMap } from '$lib/stores/presence';

	let matrixRooms = [];
	let loading = true;
	const showCreateMenu = false;
	const showGroupForm = false;
	const newGroupName = '';

	onMount(() => {
		// Trigger lazy member loading so display names resolve on iOS
		backend.loadDMMembers?.();
		const unsub = backend.onConversationsChanged((updatedRooms) => {
			const acceptedRoomIds = new Set(
				(backend.getDMContacts?.() || [])
					.filter((contact) => contact.status === 'accepted')
					.map((contact) => contact.roomId)
			);
			matrixRooms = updatedRooms.filter((room) => {
				const peer = backend.getRoomPeer(room.roomId);
				return !peer?.userId || acceptedRoomIds.has(room.roomId);
			});
			loading = false;
		});
		return unsub;
	});

	function fmtTime(iso) {
		if (!iso) return '';
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="page-header">
	<h1>{$t('chats')}</h1>
	<button class="btn-icon" aria-label={$t('newChat')} on:click={() => goto(resolve('/contacts'))}>
		<Plus size={20} />
	</button>
</div>

{#if loading}
	<div class="page-center"><p class="text-muted">...</p></div>
{:else if matrixRooms.length === 0}
	<div class="page-center"><p class="text-muted">{$t('noContacts')}</p></div>
{:else}
	<div class="conversation-list" role="list" aria-label={$t('chats')}>
		{#each matrixRooms as room (room.roomId)}
			<ConversationItem
				name={backend.getRoomPeer(room.roomId)?.name || room.name}
				email={backend.getRoomPeer(room.roomId)?.userId || room.roomId}
				time={fmtTime(room.lastActiveTs ? new Date(room.lastActiveTs).toISOString() : '')}
				unread={$unreadCounts[room.roomId]?.total || 0}
				highlight={($unreadCounts[room.roomId]?.highlight || 0) > 0}
				lastMessage={room.lastMessage}
				href={resolve('/room/' + encodeURIComponent(room.roomId))}
				online={$presenceMap[backend.getRoomPeer(room.roomId)?.userId] ?? false}
			/>
		{/each}
	</div>
{/if}

<style>
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	h1 {
		font-size: 1.125rem;
	}
	.page-center {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.conversation-list {
		flex: 1;
		overflow-y: auto;
	}
</style>
