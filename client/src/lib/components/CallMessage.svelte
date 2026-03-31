<script lang="ts">
	import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-svelte';
	import { t } from '$lib/stores/i18n';
	import {
		MatrixCallDirection,
		MatrixCallStatus,
		type MatrixCallMeta
	} from '$lib/types/matrix';

	export let callMeta: MatrixCallMeta | null = null;

	function formatDuration(secs: number | null): string {
		if (!secs) return '';
		const m = Math.floor(secs / 60);
		const s = secs % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	$: direction = callMeta?.direction ?? MatrixCallDirection.INCOMING;
	$: status = callMeta?.status ?? MatrixCallStatus.MISSED;
	$: durationSecs = callMeta?.durationSecs ?? null;
	$: answered = status === MatrixCallStatus.ANSWERED;
	$: ringing = status === MatrixCallStatus.RINGING;
	$: label =
		direction === MatrixCallDirection.OUTGOING ? $t('callLogOutgoing') : $t('callLogIncoming');
	$: statusLabel = answered ? $t('callLogAnswered') : ringing ? $t('callLogCalling') : $t('callLogMissed');
	$: duration = answered ? formatDuration(durationSecs) : '';
</script>

<div class="call-msg" class:answered class:missed={!answered && !ringing} class:ringing>
	<span class="call-icon">
		{#if answered}
			{#if direction === MatrixCallDirection.OUTGOING}
				<PhoneOutgoing size={14} />
			{:else}
				<PhoneIncoming size={14} />
			{/if}
		{:else if ringing}
			<Phone size={14} />
		{:else}
			<PhoneMissed size={14} />
		{/if}
	</span>
	<span class="call-text">
		{label} · {statusLabel}{duration ? ` · ${duration}` : ''}
	</span>
</div>

<style>
	.call-msg {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		align-self: center;
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		color: var(--text-muted);
	}
	.call-icon {
		display: flex;
		align-items: center;
	}
	.answered .call-icon {
		color: #2e7d32;
	}
	.missed .call-icon,
	.ringing .call-icon {
		color: #c62828;
	}
</style>
