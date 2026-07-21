#!/usr/bin/env bash
set -euo pipefail
if [ "${RESET_DATABASE:-0}" != 1 ] || [ "${SEED_DEMO_DATA:-0}" != 1 ]; then echo "Set RESET_DATABASE=1 and SEED_DEMO_DATA=1." >&2; exit 1; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; node "$ROOT/server/seed.js"
