"""Call link routes — create, list, deactivate, guest join."""

from fastapi import APIRouter, Depends, HTTPException

from helpers import control
from models import CallLinkInfo, GuestJoinRequest, GuestJoinResponse

router = APIRouter(prefix="/api/links", tags=["links"])


@router.post("", response_model=CallLinkInfo)
async def create_link(user_id: str = Depends(control.get_current_user_id)):
    return await control.create_call_link(user_id)


@router.get("", response_model=list[CallLinkInfo])
async def list_links(user_id: str = Depends(control.get_current_user_id)):
    return await control.list_call_links(user_id)


@router.delete("/{slug}")
async def deactivate_link(slug: str, user_id: str = Depends(control.get_current_user_id)):
    if not await control.deactivate_call_link(slug, user_id):
        raise HTTPException(status_code=404, detail="Link not found")
    return {"detail": "Link deactivated"}


@router.post("/{slug}/join", response_model=GuestJoinResponse)
async def guest_join(slug: str, req: GuestJoinRequest):
    """Public endpoint — no auth required. Guests join via link."""
    raise HTTPException(status_code=501, detail="Guest calling is not available in Matrix mode")
