"""Auth routes — register, login, refresh, me."""

from fastapi import APIRouter, Depends, HTTPException

from helpers import config
from helpers import control
from models import (
    AccessTokenResponse,
    DebugLegacyUserResponse,
    LoginRequest,
    MatrixLoginRequest,
    MatrixLoginResponse,
    PasswordResetConfirmRequest,
    PasswordResetDispatchResponse,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    ResendVerificationRequest,
    TokenResponse,
    UserProfile,
    VerificationDispatchResponse,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=RegisterResponse)
async def register(req: RegisterRequest):
    if not config.get().allow_registration:
        raise HTTPException(status_code=403, detail="Registration is closed")
    try:
        profile = await control.register_user(req.email, req.password, req.display_name)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    detail = (
        "Verification email sent. Check your spam folder."
        if profile.get("verification_sent")
        else "Registration created"
    )
    return RegisterResponse(
        detail=detail,
        verification_sent=bool(profile.get("verification_sent")),
        debug_verification_link=profile.get("debug_verification_link"),
    )


@router.post("/debug/legacy-user", response_model=DebugLegacyUserResponse)
async def create_debug_legacy_user(req: RegisterRequest):
    try:
        user = await control.create_debug_legacy_user(req.email, req.password, req.display_name)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except Exception as e:
        if config.get().email_debug:
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}") from e
        raise
    return DebugLegacyUserResponse(**user)


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    try:
        user = await control.authenticate_user(req.email, req.password)
    except control.EmailNotVerifiedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(
        access_token=control.create_access_token(user["id"]),
        refresh_token=control.create_refresh_token(user["id"]),
    )


@router.post("/matrix-login", response_model=MatrixLoginResponse)
async def matrix_login(req: MatrixLoginRequest):
    try:
        result = await control.authenticate_matrix_user(req.email, req.password)
    except control.EmailNotVerifiedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except control.PasswordResetRequiredError:
        return MatrixLoginResponse(status="reset_required")
    except control.matrix_auth.MatrixAuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    if result["status"] != "ok":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return MatrixLoginResponse(**result)


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(req: RefreshRequest):
    user_id = control.decode_token(req.refresh_token, expected_type="refresh")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return AccessTokenResponse(access_token=control.create_access_token(user_id))


@router.get("/me", response_model=UserProfile)
async def me(user_id: str = Depends(control.get_current_user_id)):
    user = await control.get_user_profile(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserProfile(
        id=user["id"],
        email=user["email"],
        display_name=user["display_name"],
    )


@router.delete("/account")
async def delete_account(user_id: str = Depends(control.get_current_user_id)):
    await control.delete_account(user_id)
    return {"detail": "Account deleted"}


@router.post("/verify", response_model=TokenResponse)
async def verify(req: VerifyEmailRequest):
    try:
        user = await control.verify_email(req.token)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=410, detail=str(e)) from e
    return TokenResponse(
        access_token=control.create_access_token(user["id"]),
        refresh_token=control.create_refresh_token(user["id"]),
    )


@router.post("/verify/resend", response_model=VerificationDispatchResponse)
async def resend_verification(req: ResendVerificationRequest):
    result = await control.resend_verification(req.email)
    detail = (
        "Verification email sent. Check your spam folder."
        if result["sent"]
        else "If the account exists, a verification email was sent"
    )
    return VerificationDispatchResponse(
        detail=detail,
        verification_sent=result["sent"],
        debug_verification_link=result["debug_verification_link"],
    )


@router.post("/password-reset/request", response_model=PasswordResetDispatchResponse)
async def request_password_reset(req: PasswordResetRequest):
    result = await control.request_password_reset(req.email)
    detail = "If the account exists, a password reset email was sent"
    return PasswordResetDispatchResponse(
        detail=detail,
        reset_sent=result["sent"],
        debug_reset_link=result["debug_reset_link"],
    )


@router.post("/password-reset/confirm")
async def confirm_password_reset(req: PasswordResetConfirmRequest):
    try:
        await control.confirm_password_reset(req.token, req.new_password)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=410, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except control.matrix_auth.MatrixAuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    return {"detail": "Password reset completed"}
