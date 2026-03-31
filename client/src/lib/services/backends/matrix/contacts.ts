import {
	_client,
	_contactsBootstrapped,
	_authErrorHandler,
	_request,
	_setContactsBootstrapped
} from './client';
import { MatrixMembership, MatrixPresence } from '$lib/types/matrix';
import type {
	MatrixAccountDataEvent,
	MatrixPresenceResponse,
	MatrixRoomLike,
	MatrixRoomMemberLike
} from '$lib/types/matrixSdk';

interface BootstrapContact {
	matrix_user_id?: string | null;
}

interface ContactSummary {
	email: string;
	roomId: string;
	display_name: string;
	status: 'pending' | 'accepted';
}

interface ContactRequestSummary {
	email: string;
	roomId: string;
	display_name: string;
}

interface RoomPeerSummary {
	name: string;
	userId: string | null;
}

const PRESENCE_STALE_MS = 60_000;

function getDirectMap(): Record<string, string[]> {
	return (
		(_client?.getAccountData<Record<string, string[]>>('m.direct') as MatrixAccountDataEvent<
			Record<string, string[]>
		> | null | undefined)?.getContent() || {}
	);
}

function getMemberContent(
	room: MatrixRoomLike | null | undefined,
	userId: string
): Record<string, unknown> {
	return room?.currentState?.getStateEvents?.('m.room.member', userId)?.getContent?.() || {};
}

function _getLocalDomain(): string {
	try {
		return _client ? new URL(_client.getHomeserverUrl()).hostname : '';
	} catch (error) {
		console.warn('_getLocalDomain: failed to parse homeserver URL:', error);
		return '';
	}
}

function _normaliseUserId(input: string): string {
	const trimmed = input.trim();
	if (/^@.+:.+/.test(trimmed)) return trimmed;
	if (trimmed.startsWith('@')) return `${trimmed}:${_getLocalDomain()}`;
	const localPart = trimmed.split(':')[0].replace(/^@/, '');
	return `@${localPart}:${_getLocalDomain()}`;
}

function _getPeerMember(
	room: MatrixRoomLike | null | undefined,
	myUserId: string
): MatrixRoomMemberLike | null {
	const members = room?.currentState?.getMembers?.() || [];
	return members.find((member) => member.userId !== myUserId) || null;
}

function _getDirectPeerUserId(
	room: MatrixRoomLike | null | undefined,
	expectedPeerUserId?: string
): string | null {
	if (!room) return expectedPeerUserId || null;
	if (expectedPeerUserId) return expectedPeerUserId;

	const dmData = getDirectMap();
	for (const [userId, roomIds] of Object.entries(dmData)) {
		if (roomIds.includes(room.roomId)) return userId;
	}
	return null;
}

function _getMemberMembership(
	room: MatrixRoomLike | null | undefined,
	userId: string
): string | null {
	const member = room?.currentState?.getMembers?.().find((entry) => entry.userId === userId);
	if (member?.membership) return member.membership;

	const content = room?.currentState?.getStateEvents?.('m.room.member', userId)?.getContent?.();
	return typeof content?.membership === 'string' ? content.membership : null;
}

function _getDirectRelationshipStatus(
	room: MatrixRoomLike | null | undefined,
	myUserId: string,
	expectedPeerUserId?: string
): 'pending' | 'accepted' | null {
	if (!room || room.getMyMembership() !== MatrixMembership.JOIN) return null;

	const peer = _getPeerMember(room, myUserId);
	const peerUserId = peer?.userId || _getDirectPeerUserId(room, expectedPeerUserId);
	if (!peerUserId || peerUserId === myUserId) return null;

	const peerMembership = peer?.membership || _getMemberMembership(room, peerUserId);
	if (peerMembership === MatrixMembership.INVITE) return 'pending';
	if (peerMembership === MatrixMembership.JOIN) return 'accepted';
	if ((room.getJoinedMemberCount?.() || 0) > 1) return 'accepted';
	return null;
}

function _peerDisplayName(room: MatrixRoomLike, myUserId: string): string {
	const member = _getPeerMember(room, myUserId);
	if (member?.name && !member.name.startsWith('@')) return member.name;

	const peerId = member?.userId;
	if (peerId) {
		const user = _client?.getUser(peerId);
		if (user?.displayName && !user.displayName.startsWith('@')) return user.displayName;
	}

	const dmData = getDirectMap();
	for (const [userId, roomIds] of Object.entries(dmData)) {
		if (roomIds.includes(room.roomId)) {
			const user = _client?.getUser(userId);
			if (user?.displayName && !user.displayName.startsWith('@')) return user.displayName;
			return userId;
		}
	}

	return peerId || room.roomId;
}

function getDMRoomIds(): Set<string> {
	return new Set(Object.values(getDirectMap()).flat());
}

function _isDirectRoom(room: MatrixRoomLike, dmRoomIds: Set<string>, myUserId: string): boolean {
	if (dmRoomIds.has(room.roomId)) return true;
	if ((room.getJoinedMemberCount?.() || 0) > 2) return false;

	const myContent = getMemberContent(room, myUserId);
	if (myContent.is_direct === true) return true;

	const members = room.currentState?.getMembers?.() || [];
	return members.some((member) => {
		if (member.userId === myUserId) return false;
		return getMemberContent(room, member.userId).is_direct === true;
	});
}

function _getKnownDirectPeerUserIds(): Set<string> {
	if (!_client) return new Set<string>();
	const myUserId = _client.getUserId();
	const dmRoomIds = getDMRoomIds();
	const known = new Set<string>();
	for (const room of _client.getRooms()) {
		const membership = room.getMyMembership();
		if (membership !== MatrixMembership.JOIN && membership !== MatrixMembership.INVITE) continue;
		if (!_isDirectRoom(room, dmRoomIds, myUserId)) continue;
		const peer = _getPeerMember(room, myUserId);
		if (peer?.userId) known.add(peer.userId);
	}
	return known;
}

export async function _bootstrapAcceptedContacts(): Promise<void> {
	if (!_client || _contactsBootstrapped) return;
	const token = _client.getAccessToken();
	if (!token) return;
	try {
		const contacts = await _request<BootstrapContact[]>('GET', '/matrix/bootstrap/contacts', null, token);
		const known = _getKnownDirectPeerUserIds();
		for (const contact of contacts || []) {
			if (!contact.matrix_user_id || known.has(contact.matrix_user_id)) continue;
			try {
				await addContact(contact.matrix_user_id);
				known.add(contact.matrix_user_id);
			} catch (error) {
				console.warn('[matrix] bootstrap contact failed:', contact.matrix_user_id, error);
			}
		}
		_setContactsBootstrapped(true);
	} catch (error) {
		const err = error as Error & { status?: number };
		if (err.status === 401) {
			_authErrorHandler?.();
			return;
		}
		console.warn('[matrix] bootstrap contacts failed:', error);
	}
}

export async function addContact(input: string): Promise<void> {
	if (!_client) throw new Error('Matrix client not initialised');
	const userId = _normaliseUserId(input);

	const dmData = getDirectMap();
	for (const roomId of dmData[userId] || []) {
		const room = _client.getRoom(roomId);
		const status = _getDirectRelationshipStatus(room, _client.getUserId(), userId);
		if (status === 'accepted' || status === 'pending') return;
	}

	const myUserId = _client.getUserId();
	const pendingInvite = _client.getRooms().find((room) => {
		if (room.getMyMembership() !== MatrixMembership.INVITE) return false;
		const myMemberEvent = room.currentState?.getStateEvents?.('m.room.member', myUserId);
		if (myMemberEvent?.getSender?.() !== userId) return false;
		return getMemberContent(room, myUserId).is_direct === true;
	});
	if (pendingInvite) {
		await acceptContact(pendingInvite.roomId);
		return;
	}

	const response = await _client.createRoom({
		is_direct: true,
		invite: [userId],
		preset: 'trusted_private_chat'
	});
	const roomId = response.room_id;
	if (!roomId) return;

	const nextDmData = getDirectMap();
	const existing = nextDmData[userId] || [];
	if (!existing.includes(roomId)) {
		nextDmData[userId] = [...existing, roomId];
		await _client.setAccountData('m.direct', nextDmData);
	}
}

export function loadDMMembers(): void {
	if (!_client) return;
	const dmRoomIds = getDMRoomIds();
	const myUserId = _client.getUserId();
	_client
		.getRooms()
		.filter(
			(room) => room.getMyMembership() === MatrixMembership.JOIN && _isDirectRoom(room, dmRoomIds, myUserId)
		)
		.forEach((room) => {
			const result = room.loadMembersIfNeeded?.();
			if (result && typeof (result as Promise<unknown>).catch === 'function') {
				void (result as Promise<unknown>).catch(() => {});
			}
		});
}

export function getDMContacts(): ContactSummary[] {
	if (!_client) return [];
	const dmRoomIds = getDMRoomIds();
	const myUserId = _client.getUserId();
	const rooms = _client
		.getRooms()
		.filter(
			(room) => room.getMyMembership() === MatrixMembership.JOIN && _isDirectRoom(room, dmRoomIds, myUserId)
		)
		.sort((left, right) => (right.getLastActiveTimestamp() || 0) - (left.getLastActiveTimestamp() || 0));

	const seen = new Map<string, ContactSummary>();
	for (const room of rooms) {
		const peer = _getPeerMember(room, myUserId);
		const peerUserId = peer?.userId || _getDirectPeerUserId(room);
		const status = _getDirectRelationshipStatus(room, myUserId, peerUserId || undefined);
		if (!status || !peerUserId) continue;
		const key = peerUserId;
		if (seen.has(key)) continue;
		seen.set(key, {
			email: peerUserId,
			roomId: room.roomId,
			display_name: _peerDisplayName(room, myUserId),
			status
		});
	}
	return [...seen.values()];
}

export function getContactRequests(): ContactRequestSummary[] {
	if (!_client) return [];
	const dmRoomIds = getDMRoomIds();
	const myUserId = _client.getUserId();
	return _client
		.getRooms()
		.filter((room) => {
			if (room.getMyMembership() !== MatrixMembership.INVITE) return false;
			if (dmRoomIds.has(room.roomId)) return true;
			return getMemberContent(room, myUserId).is_direct === true;
		})
		.map((room) => ({
			email: room.roomId,
			roomId: room.roomId,
			display_name: _peerDisplayName(room, myUserId)
		}));
}

export function getRoomPeer(roomId: string): RoomPeerSummary | null {
	if (!_client) return null;
	const room = _client.getRoom(roomId);
	if (!room) return null;
	const myUserId = _client.getUserId();
	const peer = _getPeerMember(room, myUserId);
	return { name: _peerDisplayName(room, myUserId), userId: peer?.userId || null };
}

export function onPresenceChanged(
	callback: (payload: { userId: string; presence: string }) => void
): () => void {
	if (!_client) return () => {};
	function handler(_event: unknown, user: { userId?: string; presence?: string | null }): void {
		callback({ userId: user.userId || '', presence: user.presence || MatrixPresence.OFFLINE });
	}
	_client.on('User.presence', handler);
	return () => _client?.off('User.presence', handler);
}

export function getPresence(userId: string): string {
	if (!_client) return MatrixPresence.OFFLINE;
	return _client.getUser(userId)?.presence || MatrixPresence.OFFLINE;
}

export async function fetchPresence(userIds: string[]): Promise<Record<string, string>> {
	if (!_client || userIds.length === 0) return {};
	const client = _client;
	const entries = await Promise.allSettled(
		userIds.map(async (userId) => {
			const response: MatrixPresenceResponse = await client.getPresence(userId);
			const stale =
				response.last_active_ago !== undefined &&
				response.last_active_ago !== null &&
				response.last_active_ago > PRESENCE_STALE_MS;
			const presence = stale ? MatrixPresence.OFFLINE : response.presence || MatrixPresence.OFFLINE;
			return [userId, presence] as const;
		})
	);
	return Object.fromEntries(
		entries
			.filter((entry): entry is PromiseFulfilledResult<readonly [string, string]> => entry.status === 'fulfilled')
			.map((entry) => entry.value)
	);
}

export async function acceptContact(roomId: string): Promise<void> {
	if (!_client) throw new Error('Matrix client not initialised');
	await _client.joinRoom(roomId);
	const myUserId = _client.getUserId();
	const room = _client.getRoom(roomId);
	if (room?.getMyMembership() !== MatrixMembership.JOIN) {
		await new Promise<void>((resolve) => {
			let settled = false;
			function cleanup(): void {
				if (settled) return;
				settled = true;
				_client?.off('RoomMember.membership', onMembership);
			}
			const timeout = setTimeout(() => {
				cleanup();
				resolve();
			}, 5000);
			function onMembership(_event: unknown, member: MatrixRoomMemberLike): void {
				if (member.roomId === roomId && member.userId === myUserId) {
					clearTimeout(timeout);
					cleanup();
					resolve();
				}
			}
			_client?.on('RoomMember.membership', onMembership);
		});
	}
	if (!_client) return;

	const updatedRoom = _client.getRoom(roomId);
	let peerId = _getPeerMember(updatedRoom, myUserId)?.userId;
	if (!peerId) {
		peerId = updatedRoom?.currentState?.getStateEvents?.('m.room.member', myUserId)?.getSender?.();
	}
	if (peerId && peerId !== myUserId) {
		const dmData = getDirectMap();
		const existing = dmData[peerId] || [];
		if (!existing.includes(roomId)) {
			dmData[peerId] = [...existing, roomId];
			await _client.setAccountData('m.direct', dmData);
		}
	}
}

export async function rejectContact(roomId: string): Promise<void> {
	if (!_client) throw new Error('Matrix client not initialised');
	await _client.leave(roomId);
}

export async function leaveRoom(roomId: string): Promise<void> {
	if (!_client) throw new Error('Matrix client not initialised');
	await _client.leave(roomId);
	try {
		await _client.forget(roomId);
	} catch (error) {
		console.warn('leaveRoom: forget failed (room may already be gone):', error);
	}
}
