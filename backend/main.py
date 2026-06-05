"""Recall FastAPI application entry point.

Run with: uvicorn main:app --reload
Docs at:  http://localhost:8000/docs
"""

import os

from dotenv import load_dotenv

# Load .env before any service module imports so STOCKFISH_PATH is in os.environ.
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import admin, analysis, auth, games, session, user
from services.db import init_db

# Initialise SQLite tables on every startup (idempotent).
init_db()

app = FastAPI(title="Recall — Chess Blunder Trainer API", version="1.0.0")

# CORS: locked to CORS_ORIGIN env var in production; open in local dev.
_CORS_ORIGIN: str = os.getenv("CORS_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_CORS_ORIGIN],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
