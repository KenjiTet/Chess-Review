"""BlunderDrill FastAPI application entry point.

Run with: uvicorn main:app --reload
Docs at:  http://localhost:8000/docs
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Load .env before any service module imports so STOCKFISH_PATH is in os.environ.
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import admin, analysis, auth, games, session, user
from services import analysis_queue
from services.db import init_db

# Initialise SQLite tables on every startup (idempotent).
init_db()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the background analysis queue on startup, stop it on shutdown."""
    analysis_queue.start()
    yield
    analysis_queue.stop()


app = FastAPI(title="BlunderDrill — Chess Blunder Trainer API", version="1.0.0", lifespan=lifespan)

# CORS: locked to CORS_ORIGIN env var in production; open in local dev.
_CORS_ORIGIN: str = os.getenv("CORS_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_CORS_ORIGIN],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static-asset caching policy ──────────────────────────────────────────────
# The service worker (sw.js), the HTML entry point and the PWA manifest must
# never be cached, otherwise a deploy can't be picked up: a stale sw.js means the
# browser never installs the new worker, and a stale index.html points at hashed
# chunks that no longer exist (the "loads forever / white screen" symptom). The
# content-hashed bundles under /assets/ are immutable and safe to cache forever.
_NO_CACHE_PATHS: set[str] = {"/", "/index.html", "/sw.js", "/registerSW.js", "/manifest.webmanifest"}


@app.middleware("http")
async def cache_control_headers(request, call_next):
    """Force revalidation of PWA entry points; cache hashed assets long-term."""
    response = await call_next(request)
    path: str = request.url.path

    # API responses set their own caching; never touch them here.
    if path.startswith("/api"):
        return response

    if path in _NO_CACHE_PATHS or path.endswith(".webmanifest"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"

    return response


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(session.router, prefix="/api/session", tags=["session"])
app.include_router(games.router, prefix="/api/games", tags=["games"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(user.router, prefix="/api/user", tags=["user"])


@app.get("/api/health")
def health() -> dict:
    """Railway health-check endpoint."""
    return {"status": "ok"}


# Serve the compiled React app as static files.
# FRONTEND_DIST is set in the Docker image; absent in local dev (Vite handles it).
_FRONTEND_DIST: str = os.getenv("FRONTEND_DIST", "")
if _FRONTEND_DIST and os.path.isdir(_FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="static")
