#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; cd "$ROOT"
if [ ! -f .env ]; then echo "Missing .env; configure it before starting." >&2; exit 1; fi
set -a; . ./.env; set +a
BACKEND_PORT="${BACKEND_PORT:-3001}"; FRONTEND_PORT="${FRONTEND_PORT:-3000}"
if [ ! -d node_modules ]; then echo "Backend dependencies missing; run scripts/bootstrap.sh explicitly." >&2; exit 1; fi
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do if command -v lsof >/dev/null && lsof -ti ":$port" >/dev/null 2>&1; then echo "Port $port is already in use." >&2; exit 1; fi; done
PORT="$BACKEND_PORT" node server/index.js & BACKEND_PID=$!
if [ -d web/node_modules ]; then
  (cd web && PORT="$FRONTEND_PORT" BROWSER=none npm start) & FRONTEND_PID=$!
else
  FRONTEND_PID=""
  echo "Frontend dependencies are not installed; starting the API only." >&2
fi
cleanup() { kill "$BACKEND_PID" ${FRONTEND_PID:+"$FRONTEND_PID"} 2>/dev/null || true; }; trap cleanup EXIT INT TERM
wait
