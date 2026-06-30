# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Coding guidelines
@CLAUDE.local.md

---

# BlunderDrill — Chess Blunder Trainer

## Project overview
Full-stack web app that fetches chess games from Chess.com, analyses them with Stockfish, and presents the player's blunders as interactive training positions.

## Structure
```
Chess Review v2/
├── backend/          # Python 3 FastAPI API server
├── frontend/         # React 19 + TypeScript Vite SPA
├── CLAUDE.md         # This file
├── CLAUDE.local.md   # Coding standards (imported above)
└── chess-trainer.md  # Full project documentation
```

## Stack
- **Backend:** Python 3, FastAPI, Uvicorn, python-chess, Stockfish engine, Pydantic, requests
- **Frontend:** React 19, TypeScript, Vite, Zustand, react-chessboard
- **Storage:** JSON files on disk (no database)
- **External APIs:** Chess.com Public API (no auth required)

## Running locally

### Backend
```bash
cd backend
uvicorn main:app --reload
# API docs: http://localhost:8000/docs
```
Requires a `.env` file at `backend/.env` with `STOCKFISH_PATH=<path to stockfish binary>`.

### Frontend
```bash
cd frontend
npm install
npm run dev
# Dev server: http://localhost:5173
# All /api/* requests are proxied to localhost:8000
```

## Key files
| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI app entry point, router registration, CORS |
| `backend/models.py` | All Pydantic request / response models |
| `backend/routers/session.py` | Core training session endpoints (SSE stream build) |
| `backend/services/stockfish.py` | Stockfish engine wrapper — evaluation, classification |
| `backend/services/trainer.py` | Session building logic, cache integration |
| `backend/services/cache.py` | Disk-backed JSON cache for analysis results |
| `frontend/src/api/client.ts` | Typed fetch wrapper for all backend calls |
| `frontend/src/hooks/useSession.ts` | Training session Zustand store |
| `frontend/src/components/Trainer/Trainer.tsx` | Main interactive trainer screen |

## See also
`chess-trainer.md` — Complete technical documentation for the entire project.
