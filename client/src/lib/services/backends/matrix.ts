export {
	init,
	destroy,
	reconnectIfNeeded,
	reconnectOrReload,
	handleHide,
	getHomeserver,
	saveSession,
	loadSession,
	clearSession,
	getAccessToken,
	getMediaUrl,
	getUserId,
	setAuthErrorHandler
} from './matrix/client';

export { login, register, logout, getProfile, setDisplayName } from './matrix/auth';

export {
	sendMessage,
	uploadMedia,
	sendMediaMessage,
	extractAudioInfo,
	AUDIO_MAX_DURATION_SECS,
	getHistory,
	loadMoreHistory,
	getLastMessageBody,
	getUnreadCounts,
	onMessage,
	onConversationsChanged,
	onMembershipChanged,
	sendReadReceipt,
	getPeerReadTs,
	getPeerReadEventId,
	onReadReceiptChanged,
	sendTyping,
	onTypingChanged
} from './matrix/messaging';

export {
	addContact,
	getDMContacts,
	loadDMMembers,
	getContactRequests,
	getRoomPeer,
	onPresenceChanged,
	getPresence,
	fetchPresence,
	acceptContact,
	rejectContact,
	leaveRoom
} from './matrix/contacts';

export {
	sendCallInvite,
	sendCallHangup,
	onCallSignal,
	notify,
	setCallMember,
	clearCallMember
} from './matrix/calls';

export async function joinRoom(): Promise<void> {}

export async function joinAsGuest(): Promise<void> {}

export function setMediaElements(): void {}

export { resumeAudio } from '../callSession';

export function getClientSessionId(): string {
	return globalThis.crypto?.randomUUID?.() || `mtx-${Date.now()}`;
}

export function dismissRoomInvite(): void {}
