<script>
	import { MessageSquare, Users, Settings } from 'lucide-svelte';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { requestCount } from '$lib/stores/contactRequests';
	import { totalUnread } from '$lib/stores/unread';

	const items = [
		{ href: '/', icon: MessageSquare, key: 'chats' },
		{ href: '/contacts', icon: Users, key: 'contacts' },
		{ href: '/settings', icon: Settings, key: 'settings' }
	];

	function isActive(href, path) {
		if (href === '/') return path === '/' || path.startsWith('/chat') || path.startsWith('/room');
		return path.startsWith(href);
	}
</script>

<aside class="sidebar">
	<div class="sidebar-header">
		<img src="/logo.png" alt="" class="sidebar-logo" />
		<span class="sidebar-title">FREE VOICE</span>
	</div>
	<nav aria-label="Main navigation">
		{#each items as item (item.key)}
			<a
				href={resolve(item.href)}
				class="sidebar-item"
				class:active={isActive(item.href, $page.url.pathname)}
				aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
			>
				<span class="icon-wrap">
					<svelte:component this={item.icon} size={20} />
					{#if item.key === 'contacts' && $requestCount > 0}
						<span class="badge">{$requestCount > 9 ? '9+' : $requestCount}</span>
					{/if}
					{#if item.key === 'chats' && $totalUnread > 0}
						<span class="badge">{$totalUnread > 9 ? '9+' : $totalUnread}</span>
					{/if}
				</span>
				<span>{$t(item.key)}</span>
			</a>
		{/each}
	</nav>
</aside>

<style>
	.sidebar {
		display: none;
		width: 240px;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border);
		flex-shrink: 0;
		flex-direction: column;
	}
	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px;
		font-weight: 600;
		font-size: 1.125rem;
	}
	.sidebar-logo {
		height: 28px;
	}
	.sidebar-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		color: var(--text-secondary);
		text-decoration: none;
		transition:
			background 0.15s,
			color 0.15s;
		font-size: 0.9375rem;
	}
	.sidebar-item:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		text-decoration: none;
	}
	.sidebar-item.active {
		color: var(--accent);
		background: var(--bg-tertiary);
	}
	.icon-wrap {
		position: relative;
		display: inline-flex;
	}
	.badge {
		position: absolute;
		top: -5px;
		right: -8px;
		background: var(--danger);
		color: #fff;
		font-size: 0.5625rem;
		font-weight: 700;
		min-width: 16px;
		height: 16px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 3px;
	}

	@media (min-width: 768px) {
		.sidebar {
			display: flex;
		}
	}
</style>
