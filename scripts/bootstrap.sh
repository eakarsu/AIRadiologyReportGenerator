#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; npm ci --prefix "$ROOT"; npm ci --prefix "$ROOT/web"
