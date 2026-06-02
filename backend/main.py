"""Recall FastAPI application entry point.

Run with: uvicorn main:app --reload
Docs at:  http://localhost:8000/docs
"""

from dotenv import load_dotenv

# Load .env before any service module imports so STOCKFISH_PATH is in os.environ.
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import analysis, auth, games, session

app = FastAPI(title="Recall — Chess Blunder Trainer API", version="1.0.0")

# Allow the Vite dev server to call the API during local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(session.router, prefix="/api/session", tags=["session"])
app.include_router(games.router, prefix="/api/games", tags=["games"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
