<script lang="ts">
	import Avatar from './Avatar.svelte';
	import UnreadBadge from './UnreadBadge.svelte';
	import { t } from '$lib/stores/i18n';
	import { MatrixMessageType, MatrixTimelineType, type ConversationLastMessage } from '$lib/types/matrix';

	export let name = '';
	export let email = '';
	export let lastMessage: ConversationLastMessage | string = '';
	export let time = '';
	export let online = false;
	export let unread = 0;
	export let highlight = false;
	export let href = '#';

	const SERVICE_MSGTYPES: Partial<Record<ConversationLastMessage['msgtype'], string>> = {
		[MatrixMessageType.IMAGE]: 'lastMsgPhoto',
		[MatrixMessageType.AUDIO]: 'lastMsgVoice',
		[MatrixMessageType.VIDEO]: 'lastMsgVideo',
		[MatrixMessageType.FILE]: 'lastMsgFile',
		[MatrixTimelineType.CALL]: 'lastMsgCall'
	};

	$: preview = (() => {
		const msg = lastMessage;
		if (!msg || (typeof msg === 'object' && !msg.text && !msg.msgtype)) return '';
		if (typeof msg === 'string') return msg;
		const key = SERVICE_MSGTYPES[msg.msgtype];
		return key ? $t(key) : (msg.text || '');
	})();
</script>

<a {href} class="conversation-item" aria-label="Chat with {name}">
	<div class="avatar-wrap">
		<Avatar {name} size={48} />
		{#if online}
			<span class="online-dot" aria-label="Online"></span>
		{/if}
	</div>
	<div class="conv-body">
		<div class="conv-top">
			<span class="conv-name">{name}</span>
			{#if time}
				<span class="conv-time text-muted text-sm">{time}</span>
			{/if}
		</div>
		<div class="conv-bottom">
			<span class="conv-preview text-secondary text-sm">{preview || email}</span>
			<UnreadBadge count={unread} {highlight} />
		</div>
	</div>
</a>

<style>
	.conversation-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		text-decoration: none;
		color: inherit;
		transition: background 0.1s;
		min-height: 64px;
	}
	.conversation-item:hover {
		background: var(--bg-secondary);
		text-decoration: none;
	}
	.avatar-wrap {
		position: relative;
	}
	.online-dot {
		position: absolute;
		bottom: 1px;
		right: 1px;
		width: 12px;
		height: 12px;
		background: var(--success);
		border: 2px solid var(--bg-primary);
		border-radius: 50%;
	}
	.conv-body {
		flex: 1;
		min-width: 0;
	}
	.conv-top,
	.conv-bottom {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.conv-name {
		flex: 1;
		min-width: 0;
		font-weight: 500;
		font-size: 0.9375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.conv-time {
		flex-shrink: 0;
	}
	.conv-preview {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		margin-right: 8px;
	}
</style>
