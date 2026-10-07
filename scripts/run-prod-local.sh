#!/usr/bin/env bash
# Run the built API (serving the built web app) against the local dev database.
cd "$(dirname "$0")/.."
export DATABASE_URL=${DATABASE_URL:-postgres://rm:rm@localhost:5432/readymix} PORT=${PORT:-4000} WEB_DIST=$PWD/apps/web/dist WEB_ORIGIN=${WEB_ORIGIN:-http://localhost:4000} CHROMIUM_PATH=${CHROMIUM_PATH:-/opt/pw-browsers/chromium} RATE_LIMIT_ENABLED=${RATE_LIMIT_ENABLED:-false}
exec node apps/api/dist/server.js
