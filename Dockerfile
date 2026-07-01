# ── Stage 1: Build the React frontend ──────────────────────────────────────
FROM node:20-slim AS frontend-build

# Chromium powers the post-build prerender step (frontend/scripts/prerender.mjs),
# which bakes the landing page into dist/index.html as static HTML for crawlers.
# Point Puppeteer at the system binary and skip its own Chromium download so the
# build stays lean.
RUN apt-get update && apt-get install -y chromium && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + Stockfish ────────────────────────────────────
FROM python:3.11-slim

# Install Stockfish from the Debian package manager.
RUN apt-get update && apt-get install -y stockfish && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps before copying source (better layer caching).
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source.
COPY backend/ ./

# Copy the compiled React app from Stage 1.
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Railway injects PORT; fall back to 8000 for local docker run.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
