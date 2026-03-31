"""Matrix compatibility routes — bootstrap helpers for the browser client."""

from fastapi import APIRouter, Depends

from helpers import control
from models import MatrixBootstrapContact

router = APIRouter(prefix="/api/matrix", tags=["matrix"])


@router.get("/bootstrap/contacts", response_model=list[MatrixBootstrapContact])
async def bootstrap_contacts(user: dict | None = Depends(control.get_optional_matrix_user)):
    # Pure Matrix users with no legacy DB record have no contacts to bootstrap.
    if not user:
        return []
    return await control.list_matrix_bootstrap_contacts(user["id"])
