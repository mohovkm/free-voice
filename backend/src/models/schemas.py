"""Pydantic request/response models (DTOs)."""

from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class RegisterResponse(BaseModel):
    detail: str
    verification_sent: bool
    debug_verification_link: str | None = None


class DebugLegacyUserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    verified: bool


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    email: EmailStr


class VerificationDispatchResponse(BaseModel):
    detail: str
    verification_sent: bool
    debug_verification_link: str | None = None


class PasswordResetDispatchResponse(BaseModel):
    detail: str
    reset_sent: bool
    debug_reset_link: str | None = None


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class MatrixLoginRequest(BaseModel):
    email: str  # accepts username, email, or full @user:server Matrix ID
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class MatrixLoginResponse(BaseModel):
    status: str
    access_token: str | None = None
    user_id: str | None = None
    device_id: str | None = None
    homeserver: str | None = None
    token_type: str = "bearer"


class UserProfile(BaseModel):
    id: str
    email: str
    display_name: str


class AddContactRequest(BaseModel):
    email: EmailStr


class AddContactResponse(BaseModel):
    status: str  # 'pending' | 'invited'
    email: str
    display_name: str | None = None
    invite_link: str | None = None


class MatrixBootstrapContact(BaseModel):
    email: str
    display_name: str
    matrix_user_id: str


class ContactInfo(BaseModel):
    id: str
    email: str
    display_name: str
    online: bool = False
    status: str = "accepted"


class ContactRequestInfo(BaseModel):
    id: str
    email: str
    display_name: str
    added_at: str


class CallLinkInfo(BaseModel):
    id: str
    slug: str
    room_name: str
    max_members: int
    active: bool
    created_at: str


class GuestJoinRequest(BaseModel):
    display_name: str


class GuestJoinResponse(BaseModel):
    room_name: str
    turn: dict


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict  # {p256dh: str, auth: str}
