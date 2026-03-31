import { MatrixMessageType } from './matrix';

export type MediaMessageType =
	(typeof MatrixMessageType)[keyof Pick<
		typeof MatrixMessageType,
		'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE'
	>];

export type MediaUploadLimits = Record<MediaMessageType, number>;

export interface CachedMediaEntry {
	mxcUrl: string;
	blob: Blob;
	mimeType: string;
	size: number;
	accessedAt: number;
}

export interface MediaCacheRequest {
	mxcUrl: string;
	httpUrl: string;
}
