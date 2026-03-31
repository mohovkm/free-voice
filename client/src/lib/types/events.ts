export const ClientEventType = Object.freeze({
	MESSAGE: 'message',
	CONTACT_REQUEST: 'contact_request',
	CONTACT_ACCEPTED: 'contact_accepted',
	CALL_INVITE: 'call_invite',
	ROOM_CALL_INVITE: 'room_call_invite',
	ROOM_CALL_UPDATED: 'room_call_updated',
	ROOM_CALL_ENDED: 'room_call_ended',
	CALL_DECLINE: 'call_decline',
	CALL_CANCEL: 'call_cancel',
	CALL_ANSWERED: 'call_answered',
	CALL_ENDED: 'call_ended'
} as const);

export type ClientEventType = (typeof ClientEventType)[keyof typeof ClientEventType];
