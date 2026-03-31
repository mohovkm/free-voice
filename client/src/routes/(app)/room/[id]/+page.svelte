<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { afterUpdate, onDestroy, onMount, tick } from 'svelte';
	import { get as apiGet } from '$lib/services/api';
	import { backend } from '$lib/services/activeBackend';
	import { extractAudioInfo } from '$lib/services/backends/matrix/messaging';
	import { t } from '$lib/stores/i18n';
	import { addLocalEcho, messagesFor } from '$lib/stores/matrixStore';
	import { presenceMap } from '$lib/stores/presence';
	import ChatHeader from '$lib/components/ChatHeader.svelte';
	import ChatBubble from '$lib/components/ChatBubble.svelte';
	import ChatInput from '$lib/components/ChatInput.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import TypingDots from '$lib/components/TypingDots.svelte';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';
	import {
		buildGalleryImages,
		buildLightboxState,
		buildTypingLabel,
		createTextLocalEcho,
		formatMessageTime,
		isMessageReadByPeer,
		toActiveCallState
	} from './page-helpers';
	import type { BackendRoomMessageEvent, RoomDetailsSummary } from './page-helpers';
	import {
		MatrixMessageType,
		type MatrixMediaPayload,
		type NormalizedTimelineEvent
	} from '$lib/types/matrix';
	import { ClientEventType } from '$lib/types/events';
	import type {
		ActiveCallBannerState,
		LightboxState,
		PendingAttachment,
		ReplyTarget
	} from '$lib/types/routes';

	type BackendTypingEvent = { userId: string; typing: boolean };
	type AudioMeta = { durationSecs: number | null; waveformData: number[] | null } | null;
	type MatrixBackend = typeof import('$lib/services/backends/matrix');

	const activeBackend = backend as MatrixBackend;
	const sendRoomMessage = activeBackend.sendMessage as (
		_roomId: string,
		_body: string,
		_replyToEventId?: string | null
	) => string;

	let roomId = '';
	$: roomId = $page.params.id ? decodeURIComponent($page.params.id) : '';

	let roomDisplayName = '';
	let peerUserId: string | null = null;
	let messages: NormalizedTimelineEvent[] = [];
	let unsubscribeMessages: (() => void) | null = null;
	let room: RoomDetailsSummary | null = null;
	let activeCall: ActiveCallBannerState | null = null;
	let myDisplayName = '';
	let lightboxImage: LightboxState | null = null;
	let videoMedia: MatrixMediaPayload | null = null;
	let myUserId = '';
	let messagesEl: HTMLDivElement | undefined;
	let unsubscribeMessageEvents: (() => void) | undefined;
	let unsubscribeTyping: (() => void) | undefined;
	let typingUsers: Record<string, string> = {};
	let typingTimer: ReturnType<typeof setTimeout> | null = null;
	let unsubscribeReceipt: (() => void) | undefined;
	let peerReadTs = 0;
	let peerReadEventId: string | null = null;
	let replyTarget: ReplyTarget | null = null;
	let canLoadMore = false;
	let loadingMore = false;
	const PAGE_SIZE = 30;
	let displayLimit = PAGE_SIZE;
	let isNearBottom = true;
	let uploadError: string | null = null;
	let uploadErrorTimer: ReturnType<typeof setTimeout> | null = null;
	let unsubscribeMembership: (() => void) | undefined;
	let roomContactStatus: 'pending' | 'accepted' | null = null;
	let receiptReconcileReady = false;
	let lastReceiptReconcileKey = '';
	let receiptReconcileTimer: ReturnType<typeof setTimeout> | null = null;

	function stopReceiptReconcileLoop(): void {
		receiptReconcileTimer = clearTimer(receiptReconcileTimer);
	}

	function startReceiptReconcileLoop(reconcileKey: string): void {
		stopReceiptReconcileLoop();
		let attemptsRemaining = 6;

		const run = (): void => {
			if (!receiptReconcileReady || !roomId || !isNearBottom) {
				stopReceiptReconcileLoop();
				return;
			}
			const currentKey = `${roomId}:${latestVisibleReceiptMarker}`;
			if (!latestVisibleReceiptMarker || currentKey !== reconcileKey) {
				stopReceiptReconcileLoop();
				return;
			}
			void backend.sendReadReceipt(roomId, true, true);
			attemptsRemaining -= 1;
			if (attemptsRemaining <= 0) {
				stopReceiptReconcileLoop();
				return;
			}
			receiptReconcileTimer = setTimeout(run, 1000);
		};

		void tick().then(run);
	}

	function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
		if (timer !== null) clearTimeout(timer);
		return null;
	}

	$: if (roomId || messages) {
		const peer = backend.getRoomPeer(roomId);
		roomDisplayName = peer?.name || roomId;
		peerUserId = peer?.userId || null;
	}

	$: {
		unsubscribeMessages?.();
		unsubscribeMessages = null;
		displayLimit = PAGE_SIZE;
		if (roomId) {
			unsubscribeMessages = messagesFor(roomId).subscribe((value) => {
				messages = value;
			});
		}
	}

	$: galleryImages = buildGalleryImages(messages);
	$: visibleMessages = messages.slice(-displayLimit);
	$: latestVisibleReceiptMarker =
		visibleMessages.length > 0
			? visibleMessages[visibleMessages.length - 1]?.id ||
				visibleMessages[visibleMessages.length - 1]?.txnId ||
				String(visibleMessages[visibleMessages.length - 1]?.ts || '')
			: '';
	$: isGroup = (room?.members?.length ?? 0) > 2;
	$: peerTyping = Object.keys(typingUsers).length > 0;
	$: typingLabel = buildTypingLabel(typingUsers, isGroup);
	$: if (receiptReconcileReady && roomId && isNearBottom && latestVisibleReceiptMarker) {
		const reconcileKey = `${roomId}:${latestVisibleReceiptMarker}`;
		if (reconcileKey !== lastReceiptReconcileKey) {
			lastReceiptReconcileKey = reconcileKey;
			startReceiptReconcileLoop(reconcileKey);
		}
	}

	function openLightbox(mxcUrl: string, alt: string): void {
		lightboxImage = buildLightboxState(mxcUrl, alt, galleryImages);
	}

	function showUploadError(message: string): void {
		uploadError = message;
		uploadErrorTimer = clearTimer(uploadErrorTimer);
		uploadErrorTimer = setTimeout(() => {
			uploadError = null;
		}, 6000);
	}

	function refreshRoomContactStatus(): void {
		const contact = backend.getDMContacts?.().find((entry) => entry.roomId === roomId) || null;
		roomContactStatus = contact?.status || null;
	}

	onMount(async () => {
		myUserId = backend.getUserId?.() || '';
		refreshRoomContactStatus();
		try {
			const history = await activeBackend.getHistory(roomId, 50);
			canLoadMore = (history || []).length >= 50;
			const peer = backend.getRoomPeer(roomId);
			if (peer?.name) roomDisplayName = peer.name;
			try {
				const detail = (await apiGet(`/rooms/${roomId}`)) as RoomDetailsSummary | null;
				room = detail;
				activeCall = detail?.active_call || null;
				myDisplayName = room?.members?.find((member) => member.id === myUserId)?.display_name || '';
			} catch (error) {
				console.warn(error);
				room = null;
			}
		} catch (error) {
			console.warn(error);
		}

		backend.sendReadReceipt(roomId, true);
		receiptReconcileReady = true;
		peerReadTs = backend.getPeerReadTs(roomId);
		peerReadEventId = backend.getPeerReadEventId?.(roomId) || null;

		unsubscribeTyping = backend.onTypingChanged(
			roomId,
			({ userId, typing }: BackendTypingEvent) => {
				const member = room?.members?.find((entry) => entry.id === userId);
				const displayName = member?.display_name || userId.replace(/^@/, '').split(':')[0];
				if (typing) {
					typingUsers = { ...typingUsers, [userId]: displayName };
					return;
				}
				const nextTypingUsers = { ...typingUsers };
				delete nextTypingUsers[userId];
				typingUsers = nextTypingUsers;
			}
		);

		unsubscribeReceipt = backend.onReadReceiptChanged(roomId, (ts: number) => {
			peerReadTs = ts;
			peerReadEventId = backend.getPeerReadEventId?.(roomId) || null;
		});
		unsubscribeMembership = backend.onMembershipChanged(() => {
			refreshRoomContactStatus();
		});

		unsubscribeMessageEvents = backend.onMessage((message: BackendRoomMessageEvent) => {
			if (
				message.type === ClientEventType.ROOM_CALL_INVITE ||
				message.type === ClientEventType.ROOM_CALL_UPDATED
			) {
				if ((message.room_id || message.roomId) !== roomId) return;
				activeCall = toActiveCallState(message);
				return;
			}
			if (message.type === ClientEventType.ROOM_CALL_ENDED) {
				if ((message.room_id || message.roomId) !== roomId) return;
				activeCall = null;
				return;
			}
			if ((message.roomId || message.room_id) === roomId) {
				backend.sendReadReceipt(roomId, isNearBottom);
			}
		});
	});

	onDestroy(() => {
		unsubscribeMessageEvents?.();
		unsubscribeTyping?.();
		unsubscribeReceipt?.();
		unsubscribeMembership?.();
		unsubscribeMessages?.();
		typingTimer = clearTimer(typingTimer);
		uploadErrorTimer = clearTimer(uploadErrorTimer);
		stopReceiptReconcileLoop();
	});

	afterUpdate(() => {
		if (isNearBottom && messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
		if (
			messagesEl &&
			!loadingMore &&
			(canLoadMore || messages.length > displayLimit) &&
			messagesEl.scrollHeight <= messagesEl.clientHeight
		) {
			void loadMore();
		}
	});

	async function loadMore(): Promise<void> {
		if (loadingMore || !messagesEl) return;
		if (!canLoadMore && messages.length <= displayLimit) return;
		loadingMore = true;

		const prevScrollHeight = messagesEl.scrollHeight;
		const prevScrollTop = messagesEl.scrollTop;

		try {
			displayLimit += PAGE_SIZE;
			if (messages.length <= displayLimit && canLoadMore) {
				const { canLoadMore: more } = await activeBackend.loadMoreHistory(roomId, PAGE_SIZE);
				canLoadMore = more;
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
			await tick();
			messagesEl.scrollTop = prevScrollTop + (messagesEl.scrollHeight - prevScrollHeight);
		} finally {
			loadingMore = false;
		}
	}

	function handleMessagesScroll(): void {
		if (messagesEl) {
			isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
		}
		if (
			messagesEl &&
			!loadingMore &&
			(canLoadMore || messages.length > displayLimit) &&
			messagesEl.scrollTop < 80
		) {
			void loadMore();
		}
	}

	function handleSend(event: CustomEvent<string>): void {
		if (roomContactStatus === 'pending') return;
		isNearBottom = true;
		typingTimer = clearTimer(typingTimer);
		backend.sendTyping(roomId, false);
		const replyToEventId = replyTarget?.id || null;
		const txnId = sendRoomMessage(roomId, event.detail, replyToEventId);
		addLocalEcho(
			roomId,
			createTextLocalEcho({
				txnId,
				roomId,
				senderId: myUserId,
				body: event.detail,
				senderName: myDisplayName,
				replyTarget
			})
		);
		replyTarget = null;
	}

	function handleReply(event: CustomEvent<ReplyTarget>): void {
		replyTarget = event.detail;
	}

	async function handleSendMedia(
		event: CustomEvent<{
			file: File;
			messageType: PendingAttachment['messageType'];
			isRecording?: boolean;
		}>
	): Promise<void> {
		if (roomContactStatus === 'pending') return;
		const { file, messageType, isRecording = false } = event.detail;
		const replyToEventId = replyTarget?.id || null;
		replyTarget = null;
		isNearBottom = true;
		let audioMeta: AudioMeta = null;
		if (isRecording && messageType === MatrixMessageType.AUDIO) {
			audioMeta = await extractAudioInfo(file).catch(
				() => ({ durationSecs: null, waveformData: null }) as const
			);
		}
		try {
			await backend.sendMediaMessage(roomId, file, messageType, replyToEventId, audioMeta);
		} catch (error) {
			console.warn('[room] sendMediaMessage failed:', error);
			showUploadError(error instanceof Error ? error.message : 'Upload failed');
		}
	}

	async function handleSendMediaGallery(event: CustomEvent<{ files: File[] }>): Promise<void> {
		const { files } = event.detail;
		const replyToEventId = replyTarget?.id || null;
		replyTarget = null;
		isNearBottom = true;
		for (const file of files) {
			try {
				await backend.sendMediaMessage(roomId, file, MatrixMessageType.IMAGE, replyToEventId);
			} catch (error) {
				console.warn('[room] sendMediaMessage (gallery) failed:', error);
				showUploadError(error instanceof Error ? error.message : 'Upload failed');
				break;
			}
		}
	}

	function handleTyping(event: CustomEvent<boolean>): void {
		if (roomContactStatus === 'pending') return;
		typingTimer = clearTimer(typingTimer);
		if (event.detail) {
			backend.sendTyping(roomId, true);
			typingTimer = setTimeout(() => backend.sendTyping(roomId, false), 4000);
			return;
		}
		backend.sendTyping(roomId, false);
	}

	function handleVideoCall(): void {
		if (roomContactStatus === 'pending') return;
		if (isGroup) {
			void goto(resolve(`/call/room/${roomId}`));
			return;
		}
		void goto(resolve(`/call/dial/${encodeURIComponent(roomId)}`));
	}

	function handleJoinActiveCall(): void {
		void goto(resolve(`/call/room/${roomId}`));
	}

	function handleSettings(): void {
		void goto(resolve(`/room/${roomId}/settings`));
	}

	async function handleLeave(): Promise<void> {
		if (!confirm($t('confirmLeaveChat'))) return;
		try {
			await backend.leaveRoom(roomId);
			void goto(resolve('/'));
		} catch (error) {
			alert(error instanceof Error ? error.message : 'Failed to leave room');
		}
	}
</script>

<div class="chat-view">
	<ChatHeader
		name={roomDisplayName || $t('rooms')}
		online={peerUserId ? ($presenceMap[peerUserId] ?? false) : false}
		backHref="/"
		onVideoCall={roomContactStatus === 'pending' ? null : handleVideoCall}
		onSettings={room?.role === 'owner' ? handleSettings : null}
		onLeave={handleLeave}
	/>

	{#if activeCall}
		<div class="active-call-banner">
			<div class="banner-copy">
				<div class="banner-title">{$t('callInProgress')}</div>
				<div class="banner-subtitle">
					{activeCall.participant_count}
					{$t('participants')}
					{#if activeCall.started_by_name}
						· {activeCall.started_by_name}
					{/if}
				</div>
			</div>
			<button class="btn-sm banner-join" on:click={handleJoinActiveCall}>{$t('joinCall')}</button>
		</div>
	{/if}

	<div
		class="messages"
		bind:this={messagesEl}
		role="log"
		aria-live="polite"
		on:scroll={handleMessagesScroll}
	>
		{#if loadingMore}
			<div class="load-more-spinner"><span class="spinner-sm"></span></div>
		{/if}
		{#each visibleMessages as m (m.id)}
			<ChatBubble
				body={m.body}
				type={m.type}
				media={m.media}
				mine={m.mine}
				{isGroup}
				senderName={m.senderName}
				time={formatMessageTime(m.isoTs)}
				read={isMessageReadByPeer(m, peerReadTs, peerReadEventId)}
				eventId={m.id || ''}
				replyTo={m.replyTo}
				callMeta={m.callMeta}
				on:reply={handleReply}
				on:lightbox={(e) => openLightbox(e.detail.src, e.detail.alt)}
				on:videoopen={(e) => (videoMedia = e.detail.media)}
			/>
		{/each}
	</div>

	<div
		class="typing-indicator"
		class:typing-visible={peerTyping}
		aria-live="polite"
		aria-label={typingLabel || 'Peer is typing'}
		aria-hidden={!peerTyping}
	>
		<div class="typing-bubble">
			<TypingDots />
		</div>
		{#if typingLabel}
			<span class="typing-label">{typingLabel}</span>
		{/if}
	</div>
	{#if uploadError}
		<div class="upload-error" role="alert">
			<span>{uploadError}</span>
			<button
				class="upload-error-dismiss"
				on:click={() => {
					uploadError = null;
					uploadErrorTimer = clearTimer(uploadErrorTimer);
				}}
				aria-label="Dismiss">✕</button
			>
		</div>
	{/if}
	{#if roomContactStatus === 'pending'}
		<div class="pending-contact-notice" role="status">{$t('notAContact')}</div>
	{/if}
	<ChatInput
		disabled={roomContactStatus === 'pending'}
		on:send={handleSend}
		on:sendMedia={handleSendMedia}
		on:sendMediaGallery={handleSendMediaGallery}
		on:typing={handleTyping}
		on:cancelReply={() => {
			replyTarget = null;
		}}
		replyTo={replyTarget}
	/>
</div>

{#if lightboxImage}
	<ImageLightbox
		images={galleryImages}
		index={lightboxImage.index}
		on:close={() => (lightboxImage = null)}
	/>
{/if}

{#if videoMedia}
	<div
		class="video-modal"
		role="dialog"
		aria-label="Video player"
		tabindex="-1"
		on:click|self={() => (videoMedia = null)}
		on:keydown={(e) => e.key === 'Escape' && (videoMedia = null)}
	>
		<VideoPlayer media={videoMedia} autoplay />
	</div>
{/if}

<style>
	.chat-view {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.active-call-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: #1f6f43;
		color: #fff;
	}
	.banner-copy {
		flex: 1;
		min-width: 0;
	}
	.banner-title {
		font-weight: 600;
	}
	.banner-subtitle {
		font-size: 0.8125rem;
		opacity: 0.9;
	}
	.banner-join {
		background: rgba(255, 255, 255, 0.16);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.2);
	}
	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* IE */
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.messages::-webkit-scrollbar {
		display: none;
	}
	.load-more-spinner {
		display: flex;
		justify-content: center;
		padding: 8px 0;
	}
	.spinner-sm {
		width: 20px;
		height: 20px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.typing-indicator {
		padding: 4px 16px 8px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		flex-shrink: 0;
		opacity: 0;
		max-height: 0;
		overflow: hidden;
		transition:
			opacity 300ms ease,
			max-height 300ms ease;
		pointer-events: none;
	}
	.typing-indicator.typing-visible {
		opacity: 1;
		max-height: 60px;
		pointer-events: auto;
	}
	.typing-bubble {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 8px 12px;
		background: var(--bg-secondary, #2a2a2a);
		border-radius: 16px 16px 16px 4px;
		width: fit-content;
	}
	.typing-label {
		font-size: 0.72rem;
		color: var(--text-muted);
		padding-left: 4px;
	}

	.video-modal {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: rgba(0, 0, 0, 0.92);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.upload-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--danger, #c0392b);
		color: #fff;
		font-size: 0.8125rem;
		flex-shrink: 0;
	}
	.upload-error span {
		flex: 1;
	}
	.upload-error-dismiss {
		background: none;
		color: #fff;
		border: none;
		padding: 0 4px;
		font-size: 0.875rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.pending-contact-notice {
		padding: 8px 16px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
		color: var(--text-muted);
		font-size: 0.8125rem;
	}
</style>
