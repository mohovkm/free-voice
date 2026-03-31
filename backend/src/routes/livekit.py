"""LiveKit token endpoint.

Validates a Matrix access token against Dendrite, then mints a short-lived
LiveKit Access Token (JWT) authorising the caller to join the requested room.
"""

import time

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from helpers import config
from helpers import matrix_auth

router = APIRouter(tags=["livekit"])

_LIVEKIT_TOKEN_TTL = 3600  # seconds


class LiveKitTokenRequest(BaseModel):
    room_name: str


@router.post("/api/livekit-token")
async def livekit_token(body: LiveKitTokenRequest, request: Request):
    # Extract Matrix Bearer token from Authorization header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    matrix_token = auth_header[len("Bearer ") :]

    cfg = config.get()

    try:
        user_id = await matrix_auth.whoami(matrix_token)
    except matrix_auth.MatrixAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # Mint LiveKit Access Token
    now = int(time.time())
    payload = {
        "iss": cfg.livekit_api_key,
        "sub": user_id,
        "iat": now,
        "nbf": now,
        "exp": now + _LIVEKIT_TOKEN_TTL,
        "video": {
            "roomJoin": True,
            "room": body.room_name,
            "canPublish": True,
            "canSubscribe": True,
        },
    }
    token = jwt.encode(payload, cfg.livekit_api_secret, algorithm="HS256")

    return JSONResponse({"token": token, "url": cfg.livekit_url})
