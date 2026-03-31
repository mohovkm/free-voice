<script>
	import { onMount, onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { refreshRequestCount, requestCount } from '$lib/stores/contactRequests';
	import { UserPlus, Phone, Video, Trash2, Check, X } from 'lucide-svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import UnreadBadge from '$lib/components/UnreadBadge.svelte';
	import { unreadCounts } from '$lib/stores/unread';
	import { backend } from '$lib/services/activeBackend';
	import { presenceMap } from '$lib/stores/presence';

	let contacts = [];
	let requests = [];
	let newEmail = '';
	let loading = true;
	/** Set of roomIds currently being removed — suppresses them from the rendered list immediately. */
	let removing = new SvelteSet();

	onMount(() => {
		backend.loadDMMembers?.();
		load();
		const unsubMembership = backend.onMembershipChanged(() => load());
		return () => {
			unsubMembership();
		};
	});

	async function load() {
		loading = true;
		try {
			requests = backend.getContactRequests();
			contacts = backend.getDMContacts();
			requestCount.set(requests.length);
		} finally {
			loading = false;
		}
	}

	async function addContact() {
		const id = newEmail.trim();
		if (!id) return;
		try {
			await backend.addContact(id);
			newEmail = '';
			await load();
		} catch (e) {
			alert(e.message);
		}
	}

	async function acceptRequest(roomId) {
		try {
			await backend.acceptContact(roomId);
		} catch (e) {
			alert(e.message);
			return;
		}
		await load();
	}

	async function rejectRequest(roomId) {
		try {
			await backend.rejectContact(roomId);
		} catch (e) {
			alert(e.message);
			return;
		}
		await load();
	}

	async function removeContact(roomId) {
		removing = new SvelteSet([...removing, roomId]);
		try {
			await backend.leaveRoom(roomId);
		} catch (e) {
			removing.delete(roomId);
			removing = new SvelteSet(removing);
			alert(e.message);
		}
	}
</script>

<div class="page-header">
	<h1>{$t('contacts')}</h1>
</div>

<div class="add-row">
	<input
		type="text"
		bind:value={newEmail}
		placeholder={$t('matrixIdPlaceholder')}
		on:keydown={(e) => e.key === 'Enter' && addContact()}
	/>
	<button class="btn-icon" on:click={addContact} aria-label={$t('add')}>
		<UserPlus size={20} />
	</button>
</div>

{#if loading}
	<div class="page-center"><p class="text-muted">...</p></div>
{:else}
	{#if requests.length > 0}
		<div class="section-label">{$t('contactRequests')} ({requests.length})</div>
		<div class="list" role="list">
			{#each requests as r (r.email)}
				<div class="list-item request-item">
					<Avatar name={r.display_name} size={40} />
					<div class="item-body">
						<span class="item-name">{r.display_name}</span>
						<span class="text-muted text-sm">{r.email}</span>
					</div>
					<button class="btn-accept" on:click={() => acceptRequest(r.email)} aria-label="Accept">
						<Check size={18} />
					</button>
					<button class="btn-reject" on:click={() => rejectRequest(r.email)} aria-label="Reject">
						<X size={18} />
					</button>
				</div>
			{/each}
		</div>
		{#if contacts.length > 0}
			<div class="section-label">{$t('contacts')}</div>
		{/if}
	{/if}

	{#if contacts.length === 0 && requests.length === 0}
		<div class="page-center"><p class="text-muted">{$t('noContacts')}</p></div>
	{:else}
		<div class="list" role="list">
			{#each contacts.filter((c) => !removing.has(c.roomId)) as c (c.roomId)}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="list-item"
					role={c.status === 'accepted' ? 'button' : undefined}
					tabindex={c.status === 'accepted' ? 0 : undefined}
					on:click={() => {
						if (c.status === 'accepted') goto(resolve('/room/' + encodeURIComponent(c.roomId)));
					}}
					on:keydown={(e) => {
						if (e.key === 'Enter' && c.status === 'accepted') {
							goto(resolve('/room/' + encodeURIComponent(c.roomId)));
						}
					}}
				>
					<Avatar name={c.display_name} size={40} online={$presenceMap[c.email] ?? false} />
					<div class="item-body">
						<span class="item-name">{c.display_name}</span>
						<span class="text-muted text-sm">{c.email}</span>
					</div>
					{#if c.status === 'pending'}
						<span class="pending-label">{$t('pendingRequest')}</span>
					{:else}
						<UnreadBadge count={$unreadCounts[c.roomId]?.total || 0} highlight={($unreadCounts[c.roomId]?.highlight || 0) > 0} />
					{/if}
					<div class="item-actions">
						{#if c.status !== 'pending'}
							<a
								href={resolve('/call/dial/' + encodeURIComponent(c.roomId) + '?video=0')}
								class="btn-icon"
								aria-label="Audio call {c.display_name}"
								on:click|stopPropagation|preventDefault={() =>
									goto(resolve('/call/dial/' + encodeURIComponent(c.roomId) + '?video=0'))}
							>
								<Phone size={18} />
							</a>
							<a
								href={resolve('/call/dial/' + encodeURIComponent(c.roomId))}
								class="btn-icon"
								aria-label="Video call {c.display_name}"
								on:click|stopPropagation|preventDefault={() =>
									goto(resolve('/call/dial/' + encodeURIComponent(c.roomId)))}
							>
								<Video size={18} />
							</a>
						{/if}
						<button
							class="btn-icon"
							on:click|stopPropagation={() => removeContact(c.roomId)}
							aria-label="Remove {c.display_name}"
						>
							<Trash2 size={18} />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.page-header {
		display: flex;
		align-items: center;
		padding: 12px 16px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	h1 {
		font-size: 1.125rem;
	}
	.add-row {
		display: flex;
		gap: 8px;
		padding: 12px 16px;
	}
	.add-row input {
		flex: 1;
		margin-bottom: 0;
	}
	.section-label {
		padding: 8px 16px 4px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.page-center {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.list {
		overflow-y: auto;
	}
	.list-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		color: inherit;
		cursor: pointer;
	}
	.list-item:hover {
		background: var(--bg-secondary);
	}
	.request-item {
		cursor: default;
	}
	.request-item:hover {
		background: transparent;
	}
	.item-body {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}
	.item-name {
		font-weight: 500;
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Override global btn-icon to match compact chat input buttons */
	:global(.list-item .btn-icon) {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
	}
	.item-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}
	.pending-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		background: var(--bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}
	.btn-accept {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #43a047;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.btn-reject {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--danger);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
</style>
