import type { CallEndReasonValue, CallMode, CallPhase } from './call';
import type { MediaMessageType } from './media';
import type {
	ConversationSummary,
	MatrixCallMeta,
	MatrixMediaPayload,
	MatrixReplyPreview,
	NormalizedTimelineEvent,
	UnreadCount
} from './matrix';

export interface RootLayoutOptions {
	prerender: false;
	ssr: false;
}

export interface RoomRouteParams {
	id: string;
}

export interface RoomSettingsRouteParams {
	id: string;
}

export interface CallRoomRouteParams {
	id: string;
}

export interface IncomingRoomCallRouteParams {
	id: string;
}

export interface DialCallRouteParams {
	email: string;
}

export interface ExternalCallRouteParams {
	slug: string;
}

export interface IncomingCallRouteParams {
	room: string;
}

export interface ConversationItemContract {
	conversation: ConversationSummary;
	unread?: UnreadCount | null;
	active?: boolean;
}

export interface ChatMessageContract {
	message: NormalizedTimelineEvent;
	showAvatar?: boolean;
	isGrouped?: boolean;
}

export interface ChatBubbleContract {
	body: string;
	type: NormalizedTimelineEvent['type'];
	callMeta: MatrixCallMeta | null;
	media: MatrixMediaPayload | null;
	mine: boolean;
	time: string;
	senderName: string;
	read?: boolean;
	replyTo: MatrixReplyPreview | null;
	eventId: string;
	isGroup?: boolean;
}

export interface ChatHeaderContract {
	name: string;
	online?: boolean;
	backHref?: string;
	onCall?: (() => void) | null;
	onVideoCall?: (() => void) | null;
	onSettings?: (() => void) | null;
	onLeave?: (() => void) | null;
}

export interface ReplyTarget {
	id: string;
	body: string;
	senderName: string;
}

export interface GalleryImage {
	mxcUrl: string;
	alt: string;
}

export interface LightboxState extends GalleryImage {
	index: number;
}

export interface ActiveCallBannerState {
	room_name?: string | null;
	participant_count?: number;
	started_at?: string | null;
	started_by_name?: string | null;
}

export interface PendingAttachment {
	file: File;
	messageType: MediaMessageType;
	previewUrl: string | null;
}

export interface CallViewContract {
	phase: CallPhase;
	endReason: CallEndReasonValue | null;
	remoteName: string;
	micMuted: boolean;
	camOff: boolean;
	video: boolean;
	participantCount: number;
	participantLabel: string;
	waitingForOthers: boolean;
	mode?: CallMode;
}
