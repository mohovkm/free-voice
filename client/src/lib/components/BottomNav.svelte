<script>
	import { MessageSquare, Phone, Users, Settings } from 'lucide-svelte';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { t } from '$lib/stores/i18n';
	import { requestCount } from '$lib/stores/contactRequests';
	import { totalUnread } from '$lib/stores/unread';

	const tabs = [
		{ href: '/', icon: MessageSquare, key: 'chats' },
		{ href: '/contacts', icon: Users, key: 'contacts' },
		{ href: '/settings', icon: Settings, key: 'settings' }
	];

	function isActive(href, path) {
		if (href === '/') return path === '/' || path.startsWith('/chat') || path.startsWith('/room');
		return path.startsWith(href);
	}
</script>

<nav class="bottom-nav safe-bottom" aria-label="Main navigation">
	{#each tabs as tab (tab.key)}
		<a
			href={resolve(tab.href)}
			class="nav-item"
			class:active={isActive(tab.href, $page.url.pathname)}
			aria-current={isActive(tab.href, $page.url.pathname) ? 'page' : undefined}
		>
			<span class="icon-wrap">
				<svelte:component this={tab.icon} size={22} />
				{#if tab.key === 'contacts' && $requestCount > 0}
					<span class="badge">{$requestCount > 9 ? '9+' : $requestCount}</span>
				{/if}
				{#if tab.key === 'chats' && $totalUnread > 0}
					<span class="badge">{$totalUnread > 9 ? '9+' : $totalUnread}</span>
				{/if}
			</span>
			<span>{$t(tab.key)}</span>
		</a>
	{/each}
</nav>

<style>
	.bottom-nav {
		display: flex;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
		flex-shrink: 0;
	}
	.nav-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 0;
		font-size: 0.6875rem;
		color: var(--text-muted);
		text-decoration: none;
		transition: color 0.15s;
		min-height: 44px;
		justify-content: center;
	}
	.nav-item.active {
		color: var(--accent);
	}
	.nav-item:hover {
		color: var(--text-primary);
		text-decoration: none;
	}
	.icon-wrap {
		position: relative;
		display: inline-flex;
	}
	.badge {
		position: absolute;
		top: -6px;
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
		.bottom-nav {
			display: none;
		}
	}
</style>
