<script>
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { callStore } from '$lib/stores/call';
	import { dismissRoomInvite } from '$lib/services/callSession';
	import { t } from '$lib/stores/i18n';

	$: roomId = $page.params.id;
	$: roomName = $page.url.searchParams.get('name') || $callStore.remoteName || 'Room';
	$: startedAt = $page.url.searchParams.get('started_at') || $callStore.callStartedAt || '';

	function joinCall() {
		goto(resolve('/call/room/' + roomId));
	}

	function declineInvite() {
		dismissRoomInvite(roomId, startedAt);
		goto(resolve('/room/' + roomId));
	}
</script>

<div class="incoming-screen">
	<div class="caller-info">
		<div class="avatar">📹</div>
		<p class="caller-name">{roomName}</p>
		<p class="label">{$t('incomingGroupCall')}</p>
	</div>
	<div class="incoming-actions">
		<button class="btn-decline" on:click={declineInvite} aria-label="Decline call">✕</button>
		<button class="btn-answer" on:click={joinCall} aria-label="Join call">✓</button>
	</div>
</div>

<style>
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
