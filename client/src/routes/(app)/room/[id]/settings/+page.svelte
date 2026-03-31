<script>
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { t } from '$lib/stores/i18n';
	import {
		get as apiGet,
		post as apiPost,
		patch as apiPatch,
		del as apiDel
	} from '$lib/services/api';
	import { Plus, Trash2 } from 'lucide-svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	$: roomId = $page.params.id;
	let loading = true;
	let room = null;
	let contacts = [];
	let newName = '';
	let newEmail = '';
	let error = '';
	let success = '';

	onMount(load);

	async function load() {
		loading = true;
		error = '';
		success = '';
		try {
			const [detail, contactList] = await Promise.all([
				apiGet('/rooms/' + roomId),
				apiGet('/contacts')
			]);
			if (detail?.role !== 'owner') {
				goto(resolve('/room/' + roomId));
				return;
			}
			room = detail;
			newName = detail?.name || '';
			contacts = (contactList || []).filter((contact) => contact.status === 'accepted');
		} catch (err) {
			error = err.message;
		} finally {
			loading = false;
		}
	}

	$: memberEmails = new Set((room?.members || []).map((member) => member.email));
	$: eligibleContacts = contacts.filter((contact) => !memberEmails.has(contact.email));

	async function saveName() {
		if (!newName.trim()) return;
		error = '';
		success = '';
		try {
			room = await apiPatch('/rooms/' + roomId, { name: newName.trim() });
			success = $t('roomUpdated');
		} catch (err) {
			error = err.message;
		}
	}

	async function addMember() {
		const email = newEmail.trim();
		if (!email) return;
		error = '';
		success = '';
		try {
			await apiPost('/rooms/' + roomId + '/members', { email });
			newEmail = '';
			success = $t('memberAdded');
			await load();
		} catch (err) {
			error = err.message;
		}
	}

	async function removeMember(email) {
		error = '';
		success = '';
		try {
			await apiDel('/rooms/' + roomId + '/members/' + encodeURIComponent(email));
			await load();
		} catch (err) {
			error = err.message;
		}
	}
</script>

<div class="page-header">
	<button class="btn-icon" on:click={() => goto(resolve('/room/' + roomId))} aria-label="Back"
		>←</button
	>
	<h1>{$t('roomSettings')}</h1>
</div>

{#if loading}
	<div class="page-center"><p class="text-muted">...</p></div>
{:else if room}
	<div class="settings-page">
		<label class="section-label" for="room-name">{$t('roomNamePlaceholder')}</label>
		<div class="add-row">
			<input
				id="room-name"
				type="text"
				bind:value={newName}
				placeholder={$t('roomNamePlaceholder')}
				on:keydown={(e) => e.key === 'Enter' && saveName()}
			/>
			<button class="btn-sm" on:click={saveName}>{$t('saveChanges')}</button>
		</div>

		<div class="section-label">{$t('addMember')}</div>
		<div class="hint">{$t('onlyContactsCanBeAdded')}</div>
		<div class="add-row">
			<input
				type="email"
				bind:value={newEmail}
				placeholder={$t('addContactPlaceholder')}
				list="eligible-room-contacts"
				on:keydown={(e) => e.key === 'Enter' && addMember()}
			/>
			<button class="btn-icon" on:click={addMember} aria-label={$t('addMember')}>
				<Plus size={20} />
			</button>
		</div>
		<datalist id="eligible-room-contacts">
			{#each eligibleContacts as contact (contact.email)}
				<option value={contact.email}>{contact.display_name}</option>
			{/each}
		</datalist>
		{#if eligibleContacts.length === 0}
			<div class="hint">{$t('noEligibleContacts')}</div>
		{/if}

		<div class="section-label">{$t('members')} ({room.member_count})</div>
		<div class="list" role="list">
			{#each room.members as member (member.id)}
				<div class="list-item">
					<Avatar name={member.display_name} size={40} />
					<div class="item-body">
						<span class="item-name">{member.display_name}</span>
						<span class="text-muted text-sm">{member.email}</span>
					</div>
					<span class="role-pill">{member.role === 'owner' ? $t('owner') : $t('member')}</span>
					{#if member.role !== 'owner'}
						<button
							class="btn-icon"
							on:click={() => removeMember(member.email)}
							aria-label={$t('removeMember')}
						>
							<Trash2 size={18} />
						</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if error}
			<div class="hint error">{error}</div>
		{/if}
		{#if success}
			<div class="hint success">{success}</div>
		{/if}
	</div>
{/if}

<style>
	.page-header {
		display: flex;
		align-items: center;
		gap: 8px;
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
	.settings-page {
		padding: 12px 16px 20px;
	}
	.section-label {
		display: block;
		padding: 8px 0 6px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.add-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.add-row input {
		flex: 1;
		margin-bottom: 0;
	}
	.hint {
		font-size: 0.8125rem;
		color: var(--text-muted);
		margin-bottom: 8px;
	}
	.hint.error {
		color: var(--danger);
	}
	.hint.success {
		color: var(--success);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.list-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
	}
	.item-body {
		flex: 1;
		min-width: 0;
	}
	.item-name {
		display: block;
		font-weight: 500;
	}
	.role-pill {
		font-size: 0.75rem;
		color: var(--text-muted);
		background: var(--bg-secondary);
		border-radius: var(--radius-sm);
		padding: 3px 8px;
	}
</style>
