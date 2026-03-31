export type AuthUserId = string;

export interface AuthTokens {
	accessToken: string;
	refreshToken: string | null;
}

export interface JwtPayload {
	sub?: AuthUserId;
	exp?: number;
	[key: string]: unknown;
}

export interface AuthSessionState {
	loggedIn: boolean;
	currentUser: AuthUserId | null;
	matrixUserId: AuthUserId | null;
}

export interface MatrixSessionState {
	accessToken: string;
	userId: AuthUserId;
	deviceId: string | null;
}
