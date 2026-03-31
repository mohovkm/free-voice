"""FREE VOICE API — app factory, router mounting, lifecycle."""

import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

from contextlib import asynccontextmanager  # noqa: E402

from fastapi import FastAPI  # noqa: E402

from helpers import config  # noqa: E402
from helpers import control  # noqa: E402
from helpers import dao  # noqa: E402
from routes.auth import router as auth_router  # noqa: E402
from routes.links import router as links_router  # noqa: E402
from routes.livekit import router as livekit_router  # noqa: E402
from routes.matrix import router as matrix_router  # noqa: E402
from routes.push import router as push_router  # noqa: E402

logger = logging.getLogger("voip-api")


async def _guest_cleanup_loop():
    """Background task: clean up expired guest endpoints every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        try:
            count = await control.cleanup_expired_guests()
            if count:
                logger.info("Cleaned up %d expired guest endpoints", count)
        except Exception:
            logger.exception("Guest cleanup failed")


@asynccontextmanager
async def lifespan(application: FastAPI):
    config.init()
    await dao.init_pool()
    task = asyncio.create_task(_guest_cleanup_loop())
    yield
    task.cancel()
    await dao.close_pool()


app = FastAPI(docs_url=None, redoc_url=None, lifespan=lifespan)
app.include_router(auth_router)
app.include_router(links_router)
app.include_router(push_router)
app.include_router(livekit_router)
app.include_router(matrix_router)
