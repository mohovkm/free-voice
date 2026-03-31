"""Push subscription routes — keyed by Matrix user ID."""

import json
import logging
import urllib.parse

import aiohttp
from fastapi import APIRouter, HTTPException, Request
from pywebpush import webpush

from helpers import config
from helpers import control
from helpers import matrix_auth
from helpers import push_i18n
from models import PushSubscription

_log = logging.getLogger("push")
router = APIRouter(prefix="/api/push", tags=["push"])


async def _matrix_user_id(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    try:
        return await matrix_auth.whoami(auth_header[len("Bearer ") :])
    except matrix_auth.MatrixAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def _resolve_display_name(sender: str) -> str:
    if not sender:
        return ""
    try:
        url = f"{config.get().dendrite_url}/_matrix/client/v3/profile/{urllib.parse.quote(sender)}/displayname"
        async with (
            aiohttp.ClientSession() as s,
            s.get(url, timeout=aiohttp.ClientTimeout(total=3)) as r,
        ):
            if r.status == 200:
                data = await r.json()
                if data.get("displayname"):
                    return data["displayname"]
    except Exception:
        pass
    return sender.split(":")[0].lstrip("@") if ":" in sender else sender


def _build_push_payload(notification: dict, display_name: str, lang: str = "en") -> dict | None:
    event_type = notification.get("type", "")
    content = notification.get("content", {})
    room_id = notification.get("room_id", "")

    if event_type == "m.call.invite":
        video = content.get("offer", {}).get("sdp", "").count("m=video") > 0
        body = push_i18n.t("push_call_video" if video else "push_call_audio", lang)
        return {
            "type": "call",
            "title": display_name,
            "body": body,
            "from": display_name,
            "room_id": room_id,
            "video": video,
            "target": {"kind": "root"},
        }

    if event_type == "m.room.member" and content.get("membership") == "invite":
        return {
            "type": "contact",
            "title": display_name,
            "body": push_i18n.t("push_contact_request", lang),
            "from": display_name,
            "target": {"kind": "root"},
        }

    # m.call.member is a MatrixRTC membership event — not actionable, suppress entirely
    if event_type == "m.call.member":
        return None

    # m.room.member non-invite events (join/leave/ban) — not actionable, suppress
    if event_type == "m.room.member":
        return None

    # m.room.message — map msgtype to a human label or text preview
    msgtype = content.get("msgtype", "")
    if msgtype == "m.image":
        body = push_i18n.t("push_photo", lang)
    elif msgtype in ("m.audio", "m.voice"):
        body = push_i18n.t("push_voice", lang)
    elif msgtype == "m.video":
        body = push_i18n.t("push_video", lang)
    elif msgtype == "m.text":
        body = content.get("body", "")[:120]
    else:
        # m.file and any other msgtype
        body = push_i18n.t("push_attachment", lang) if msgtype else content.get("body", "")[:120]

    return {
        "type": "chat",
        "title": display_name,
        "body": body,
        "from": display_name,
        "target": {"kind": "room", "room_id": room_id},
    }


@router.get("/vapid-key")
async def vapid_key():
    return {"public_key": config.get().vapid_public_key}


@router.get("/config")
async def push_config():
    cfg = config.get()
    return {
        "vapid_public_key": cfg.vapid_public_key,
        "sygnal_url": cfg.sygnal_url,
        "app_id": cfg.sygnal_app_id,
    }


@router.post("/notify")
async def notify(request: Request):
    """Matrix push gateway — receives from Dendrite, delivers via pywebpush."""
    cfg = config.get()
    if not cfg.vapid_private_key:
        return {"rejected": []}
    body = await request.json()
    notification = body.get("notification", {})
    sender = notification.get("sender", "")
    display_name = await _resolve_display_name(sender)
    rejected = []
    for device in notification.get("devices", []):
        data = device.get("data", {})
        endpoint = data.get("endpoint")
        auth = data.get("auth")
        p256dh = device.get("pushkey")
        if not endpoint or not auth or not p256dh:
            rejected.append(p256dh or "")
            continue
        # Skip pushing to the sender's own device (Dendrite pushes to all room members)
        if sender:
            device_owner = await control.get_push_user_by_pushkey(p256dh)
            if device_owner == sender:
                continue
        lang = data.get("lang", "en")
        payload_obj = _build_push_payload(notification, display_name, lang)
        # None means this event type should not generate a push (e.g. m.call.member)
        if payload_obj is None:
            continue
        payload = json.dumps(payload_obj)
        try:
            webpush(
                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                data=payload,
                vapid_private_key=cfg.vapid_private_key,
                vapid_claims={"sub": cfg.vapid_claims_email},
                ttl=86400,
            )
        except Exception as e:
            _log.warning("Push failed for %s: %s", endpoint[:60], e)
            rejected.append(p256dh)
            # 410 Gone = subscription expired/unregistered — delete it so we stop retrying
            err_str = str(e)
            if "410" in err_str or "Gone" in err_str or "No such subscription" in err_str:
                try:
                    await control.unsubscribe_push_by_endpoint(endpoint)
                except Exception as del_err:
                    _log.warning("Failed to delete stale push subscription: %s", del_err)
    return {"rejected": rejected}


@router.post("/subscribe")
async def subscribe(sub: PushSubscription, request: Request):
    uid = await _matrix_user_id(request)
    await control.subscribe_push(
        uid, sub.endpoint, sub.keys.get("p256dh", ""), sub.keys.get("auth", "")
    )
    return {"detail": "Subscribed"}


@router.delete("/subscribe")
async def unsubscribe(sub: PushSubscription, request: Request):
    uid = await _matrix_user_id(request)
    if not await control.unsubscribe_push(uid, sub.endpoint):
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"detail": "Unsubscribed"}
