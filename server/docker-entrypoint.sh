#!/bin/sh
# Backend container entrypoint:
#   1. wait until PostgreSQL accepts connections,
#   2. apply the idempotent schema and seed,
#   3. start the API (only then does it accept traffic).
set -e

echo "[entrypoint] waiting for the database..."
node scripts/wait-for-db.js

echo "[entrypoint] applying database schema..."
node scripts/migrate.js

echo "[entrypoint] starting the API on port ${PORT:-3001}..."
exec node index.js
