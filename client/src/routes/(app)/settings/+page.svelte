<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { t, locale, availableLocales } from '$lib/stores/i18n';
	import { theme } from '$lib/stores/theme';
	import { logout } from '$lib/stores/auth';
	import { backend } from '$lib/services/activeBackend';
	import { subscribePush } from '$lib/services/push';
	import {
		ChevronRight,
		Globe,
		Palette,
		LogOut,
		Info,
		BookOpen,
		RefreshCw,
		Bell,
		Pencil,
		Check,
		X
	} from 'lucide-svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	let profile = { display_name: '', email: '', id: '' };
	let clearing = false;
	let editingName = false;
	let nameInput = '';
	let nameSaving = false;
	let nameError = '';
	const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

	// Push status: 'checking' | 'ok' | 'no_permission' | 'no_subscription' | 'unsupported'
	let pushStatus = 'checking';

	async function checkPushStatus(repair = false) {
		if (
			typeof Notification === 'undefined' ||
			!('serviceWorker' in navigator) ||
			!('PushManager' in window)
		) {
			pushStatus = 'unsupported';
			return;
		}
		if (Notification.permission !== 'granted') {
			pushStatus = 'no_permission';
			return;
		}
		try {
			let reg = await navigator.serviceWorker.ready;
			let sub = await reg.pushManager.getSubscription();
			if (!sub && repair) {
				await subscribePush();
				reg = await navigator.serviceWorker.ready;
				sub = await reg.pushManager.getSubscription();
			}
			pushStatus = sub ? 'ok' : 'no_subscription';
		} catch (err) {
			console.warn(err);
			pushStatus = 'no_subscription';
		}
	}

	async function enableNotifications() {
		const perm = await Notification.requestPermission();
		if (perm === 'granted') await subscribePush();
		await checkPushStatus();
	}

	async function saveDisplayName() {
		if (!nameInput.trim()) return;
		nameSaving = true;
		nameError = '';
		try {
			await backend.setDisplayName(nameInput.trim());
			profile = { ...profile, display_name: nameInput.trim() };
			editingName = false;
		} catch (e) {
			nameError = e.message || String(e);
		} finally {
			nameSaving = false;
		}
	}

	function startEditName() {
		nameInput = profile.display_name;
		nameError = '';
		editingName = true;
	}

	onMount(() => {
		(async () => {
			try {
				profile = (await backend.getProfile()) ?? profile;
			} catch (err) {
				console.warn(err);
			}
		})();
		// Check push status in background — do not block page render
		checkPushStatus(true);
		const refreshPushStatus = () => checkPushStatus(true);
		window.addEventListener('focus', refreshPushStatus);
		document.addEventListener('visibilitychange', refreshPushStatus);
		return () => {
			window.removeEventListener('focus', refreshPushStatus);
			document.removeEventListener('visibilitychange', refreshPushStatus);
		};
	});

	const localeNames = { en: 'English', ru: 'Русский' };
	const themeNames = { dark: 'darkTheme', light: 'lightTheme', system: 'systemTheme' };

	async function handleLogout() {
		await backend.logout();
		await goto(resolve('/login'), { replaceState: true });
		await logout();
	}

	function cycleLocale() {
		const idx = availableLocales.indexOf($locale);
		locale.set(availableLocales[(idx + 1) % availableLocales.length]);
	}

	function cycleTheme() {
		const themes = ['dark', 'light', 'system'];
		const idx = themes.indexOf($theme);
		theme.set(themes[(idx + 1) % themes.length]);
	}

	async function clearCache() {
		clearing = true;
		try {
			if ('serviceWorker' in navigator) {
				// Unsubscribe push browser-side before clearing SW registration
				if ('PushManager' in window) {
					try {
						const reg = await navigator.serviceWorker.ready;
						const sub = await reg.pushManager.getSubscription();
						if (sub) await sub.unsubscribe();
					} catch (err) {
						console.warn(err);
					}
				}
				const regs = await navigator.serviceWorker.getRegistrations();
				await Promise.all(regs.map((r) => r.unregister()));
			}
			const keys = await caches.keys();
			await Promise.all(keys.map((k) => caches.delete(k)));
		} finally {
			location.reload();
		}
	}
</script>

<div class="page-header">
	<h1>{$t('settings')}</h1>
</div>

<div class="settings-list">
	<!-- Profile -->
	<div class="settings-section">
		<div class="profile-row">
			<Avatar name={profile.display_name || ''} size={56} />
			<div class="profile-info">
				{#if editingName}
					<div class="name-edit-row">
						<input
							class="name-input"
							type="text"
							bind:value={nameInput}
							on:keydown={(e) => e.key === 'Enter' && saveDisplayName()}
						/>
						<button
							class="icon-btn"
							on:click={saveDisplayName}
							disabled={nameSaving}
							aria-label="Save"><Check size={16} /></button
						>
						<button class="icon-btn" on:click={() => (editingName = false)} aria-label="Cancel"
							><X size={16} /></button
						>
					</div>
					{#if nameError}<span class="text-danger text-sm">{nameError}</span>{/if}
				{:else}
					<div class="name-row">
						<span class="profile-name">{profile.display_name || ''}</span>
						<button class="icon-btn" on:click={startEditName} aria-label="Edit name"
							><Pencil size={14} /></button
						>
					</div>
				{/if}
				{#if profile.id}
					<span class="text-muted text-sm">{profile.id}</span>
				{:else}
					<span class="text-muted text-sm">{profile.email || ''}</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- App settings -->
	<div class="settings-section">
		<button class="settings-item" on:click={cycleLocale}>
			<Globe size={20} />
			<span class="item-label">{$t('language')}</span>
			<span class="item-value text-muted">{localeNames[$locale] || $locale}</span>
			<ChevronRight size={16} />
		</button>
		<button class="settings-item" on:click={cycleTheme}>
			<Palette size={20} />
			<span class="item-label">{$t('theme')}</span>
			<span class="item-value text-muted">{$t(themeNames[$theme] || 'darkTheme')}</span>
			<ChevronRight size={16} />
		</button>
	</div>

	<!-- Navigation -->
	<div class="settings-section">
		<a href={resolve('/links')} class="settings-item">
			<span class="item-label">{$t('links')}</span>
			<ChevronRight size={16} />
		</a>
		<a href={resolve('/guide')} class="settings-item">
			<BookOpen size={20} />
			<span class="item-label">{$t('guideWelcome')}</span>
			<ChevronRight size={16} />
		</a>
		<a href={resolve('/about')} class="settings-item">
			<Info size={20} />
			<span class="item-label">{$t('aboutTitle')}</span>
			<ChevronRight size={16} />
		</a>
	</div>

	<!-- Logout -->
	<div class="settings-section">
		{#if isIOS}
			<div class="settings-item notif-hint">
				<span class="item-label text-sm">{$t('notifSettingsHint')}</span>
			</div>
		{/if}
		{#if pushStatus === 'ok'}
			<div class="settings-item notif-ok">
				<Bell size={20} />
				<span class="item-label">{$t('notifStatusOk')}</span>
				<span class="status-dot ok"></span>
			</div>
		{:else if pushStatus === 'no_permission' || pushStatus === 'no_subscription'}
			<button class="settings-item notif-warn" on:click={enableNotifications}>
				<Bell size={20} />
				<span class="item-label">{$t('enableNotifications')}</span>
				<span class="status-dot warn"></span>
			</button>
		{:else if pushStatus === 'unsupported'}
			<div class="settings-item notif-hint">
				<Bell size={20} />
				<span class="item-label text-muted">{$t('notifUnsupported')}</span>
			</div>
		{/if}
		<button class="settings-item" on:click={clearCache} disabled={clearing}>
			<RefreshCw size={20} />
			<span class="item-label">{clearing ? $t('clearing') : $t('clearCache')}</span>
		</button>
		<button class="settings-item danger" on:click={handleLogout}>
			<LogOut size={20} />
			<span class="item-label">{$t('logout')}</span>
		</button>
	</div>
</div>

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
	.settings-list {
		flex: 1;
		overflow-y: auto;
	}
	.settings-section {
		border-bottom: 1px solid var(--border);
		padding: 4px 0;
	}
	.profile-row {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px;
	}
	.profile-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.profile-name {
		font-weight: 600;
		font-size: 1.0625rem;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.name-edit-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.name-input {
		font-size: 1rem;
		padding: 2px 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		color: var(--text);
		width: 160px;
	}
	.icon-btn {
		background: none;
		border: none;
		padding: 2px;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
	}
	.icon-btn:hover {
		color: var(--text);
	}
	.text-danger {
		color: var(--danger);
	}
	.settings-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		width: 100%;
		text-align: left;
		color: inherit;
		text-decoration: none;
		transition: background 0.1s;
	}
	.settings-item:hover {
		background: var(--bg-secondary);
		text-decoration: none;
	}
	.item-label {
		flex: 1;
		font-size: 0.9375rem;
	}
	.item-value {
		font-size: 0.875rem;
	}
	.danger {
		color: var(--danger);
	}
	.notif-hint {
		color: var(--text-secondary);
		font-size: 0.875rem;
		cursor: default;
	}
	.notif-ok {
		color: var(--success, #4caf50);
		cursor: default;
	}
	.notif-warn {
		color: var(--warning, #ff9800);
	}
	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.status-dot.ok {
		background: var(--success, #4caf50);
	}
	.status-dot.warn {
		background: var(--warning, #ff9800);
	}
</style>
