export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
	[key: string]: JsonValue;
}

export type ApiRequestBody = JsonObject | JsonValue[] | null;

export interface ApiErrorPayload {
	detail: string;
}

export interface RefreshTokenRequest {
	refresh_token: string;
}
